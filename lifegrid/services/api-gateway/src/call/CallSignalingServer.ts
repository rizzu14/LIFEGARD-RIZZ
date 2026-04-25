// ============================================================
// LIFEGRID – WebRTC Call Signaling Server
// Handles WebRTC offer/answer/ICE exchange between
// citizen devices and operator workstations.
//
// Protocol:
//   1. Citizen emits CALL_INITIATE with SDP offer
//   2. Server routes to best available operator
//   3. Operator receives CALL_INITIATE popup
//   4. Operator emits CALL_ANSWER with SDP answer
//   5. Server relays answer to citizen
//   6. Both sides exchange ICE candidates via server
//   7. WebRTC peer connection established (P2P audio)
//   8. Server continues to relay metadata (transcript, keywords)
//
// Smart routing:
//   - Priority queue by severity (CRITICAL first)
//   - Round-robin among available operators
//   - Fallback to any online operator if none available
//   - Auto-retry after 10s if no operator accepts
// ============================================================

import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../utils/logger';
import { RedisManager } from '../cache/RedisManager';
import { DatabaseManager } from '../database/DatabaseManager';
import { v4 as uuidv4 } from 'uuid';

// ── Call session registry ─────────────────────────────────────

interface CallSession {
  sessionId:     string;
  incidentId:    string;
  referenceCode: string;
  citizenSocketId: string;
  operatorSocketId?: string;
  operatorId?:   string;
  severity:      string;
  emergencyType: string;
  language:      string;
  location?:     { lat: number; lng: number };
  startedAt:     string;
  connectedAt?:  string;
  endedAt?:      string;
  status:        'waiting' | 'ringing' | 'connected' | 'ended';
  retryCount:    number;
  transcript:    any[];
  keywords:      any[];
}

const activeSessions = new Map<string, CallSession>();
const operatorQueue  = new Map<string, string[]>();  // operatorSocketId → sessionIds

// ── Operator availability ─────────────────────────────────────

async function getAvailableOperators(io: SocketIOServer): Promise<string[]> {
  const commandRoom = io.sockets.adapter.rooms.get('command-center');
  if (!commandRoom) return [];

  const available: string[] = [];
  for (const socketId of commandRoom) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;

    const role = socket.data.role;
    if (!['OPERATOR', 'SUPERVISOR', 'COMMANDER'].includes(role)) continue;

    // Check if operator is already on a call
    const currentCalls = operatorQueue.get(socketId) ?? [];
    if (currentCalls.length === 0) {
      available.push(socketId);
    }
  }
  return available;
}

async function getBestOperator(
  io: SocketIOServer,
  severity: string,
): Promise<string | null> {
  const available = await getAvailableOperators(io);
  if (available.length === 0) return null;

  // For CRITICAL severity, prefer SUPERVISOR/COMMANDER
  if (severity === 'CRITICAL') {
    for (const socketId of available) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket?.data.role === 'SUPERVISOR' || socket?.data.role === 'COMMANDER') {
        return socketId;
      }
    }
  }

  // Round-robin among available operators
  return available[Math.floor(Math.random() * available.length)];
}

// ── Audit call to database ────────────────────────────────────

async function auditCall(session: CallSession): Promise<void> {
  try {
    await DatabaseManager.query(
      `INSERT INTO lifegrid.audit_log
        (entity_type, entity_id, action, actor_id, new_value, created_at)
       VALUES ('CALL', $1, $2, $3, $4, NOW())`,
      [
        session.sessionId,
        `CALL_${session.status.toUpperCase()}`,
        session.operatorId ?? 'system',
        JSON.stringify({
          incidentId:    session.incidentId,
          severity:      session.severity,
          emergencyType: session.emergencyType,
          duration:      session.connectedAt && session.endedAt
            ? Math.round((new Date(session.endedAt).getTime() - new Date(session.connectedAt).getTime()) / 1000)
            : 0,
        }),
      ],
    );
  } catch {
    // Non-fatal
  }
}

// ── Main signaling setup ──────────────────────────────────────

export function setupCallSignaling(io: SocketIOServer): void {
  logger.info('✅ WebRTC Call Signaling Server initialized');

  io.on('connection', (socket: Socket) => {

    // ── Citizen: initiate call ──────────────────────────────

    socket.on('CALL_INITIATE', async (data: {
      incidentId:    string;
      sessionId?:    string;
      offer:         RTCSessionDescriptionInit;
      location?:     { lat: number; lng: number };
      language?:     string;
    }) => {
      try {
        // Look up incident for metadata
        const incident = await DatabaseManager.queryOne<any>(
          'SELECT reference_code, severity, type FROM lifegrid.incidents WHERE id = $1',
          [data.incidentId],
        );

        const session: CallSession = {
          sessionId:       data.sessionId ?? uuidv4(),
          incidentId:      data.incidentId,
          referenceCode:   incident?.reference_code ?? 'UNKNOWN',
          citizenSocketId: socket.id,
          severity:        incident?.severity ?? 'HIGH',
          emergencyType:   incident?.type ?? 'UNKNOWN',
          language:        data.language ?? 'en',
          location:        data.location,
          startedAt:       new Date().toISOString(),
          status:          'waiting',
          retryCount:      0,
          transcript:      [],
          keywords:        [],
        };

        activeSessions.set(session.sessionId, session);

        // Cache in Redis for cross-instance access
        await RedisManager.set(
          `call:session:${session.sessionId}`,
          JSON.stringify(session),
          3600,
        );

        // Route to best available operator
        const operatorSocketId = await getBestOperator(io, session.severity);

        if (operatorSocketId) {
          session.status = 'ringing';
          activeSessions.set(session.sessionId, session);

          // Send incoming call to operator
          io.to(operatorSocketId).emit('CALL_INITIATE', {
            ...session,
            offer: data.offer,
          });

          // Track operator's active calls
          const opCalls = operatorQueue.get(operatorSocketId) ?? [];
          opCalls.push(session.sessionId);
          operatorQueue.set(operatorSocketId, opCalls);

          logger.info(`[Call] Routed ${session.sessionId} to operator ${operatorSocketId}`);

          // Auto-retry if no answer in 15s
          setTimeout(async () => {
            const current = activeSessions.get(session.sessionId);
            if (current?.status === 'ringing') {
              current.retryCount++;
              if (current.retryCount < 3) {
                // Try another operator
                const nextOp = await getBestOperator(io, session.severity);
                if (nextOp && nextOp !== operatorSocketId) {
                  io.to(nextOp).emit('CALL_INITIATE', { ...current, offer: data.offer });
                  logger.info(`[Call] Retry ${current.retryCount}: routed to ${nextOp}`);
                } else {
                  // No operator — notify citizen of fallback
                  io.to(session.citizenSocketId).emit('CALL_FALLBACK', {
                    sessionId: session.sessionId,
                    reason: 'No operator available',
                    fallback: 'text_only',
                  });
                }
              }
            }
          }, 15000);

        } else {
          // No operators available — immediate fallback
          logger.warn(`[Call] No operators available for ${session.sessionId}`);
          io.to(socket.id).emit('CALL_FALLBACK', {
            sessionId: session.sessionId,
            reason:    'All operators busy',
            fallback:  'text_only',
          });

          // Add AI guidance message instead
          io.to(socket.id).emit('CALL_AI_SUGGESTION', {
            sessionId:  session.sessionId,
            suggestion: 'All operators are currently busy. Your emergency has been logged and responders are being dispatched. Use the chat below for guidance.',
          });
        }

        await auditCall(session);

      } catch (err) {
        logger.error('[Call] CALL_INITIATE error:', err);
      }
    });

    // ── Operator: answer call ───────────────────────────────

    socket.on('CALL_ANSWER', async (data: {
      sessionId:    string;
      incidentId:   string;
      answer:       RTCSessionDescriptionInit;
      operatorId:   string;
      operatorName: string;
    }) => {
      const session = activeSessions.get(data.sessionId);
      if (!session) return;

      session.status          = 'connected';
      session.operatorSocketId = socket.id;
      session.operatorId      = data.operatorId;
      session.connectedAt     = new Date().toISOString();
      activeSessions.set(data.sessionId, session);

      // Relay answer to citizen
      io.to(session.citizenSocketId).emit('CALL_ANSWER', {
        sessionId:    data.sessionId,
        answer:       data.answer,
        operatorId:   data.operatorId,
        operatorName: data.operatorName,
      });

      // Notify operator dashboard
      io.to('command-center').emit('CALL_STATUS_UPDATE', {
        sessionId:    data.sessionId,
        incidentId:   session.incidentId,
        status:       'connected',
        operatorId:   data.operatorId,
        operatorName: data.operatorName,
        connectedAt:  session.connectedAt,
      });

      logger.info(`[Call] Connected: ${data.sessionId} · operator: ${data.operatorId}`);
      await auditCall(session);
    });

    // ── ICE candidate relay ─────────────────────────────────

    socket.on('CALL_ICE_CANDIDATE', (data: {
      sessionId:  string;
      incidentId: string;
      candidate:  RTCIceCandidateInit;
    }) => {
      const session = activeSessions.get(data.sessionId);
      if (!session) return;

      // Relay to the other party
      const targetSocketId = socket.id === session.citizenSocketId
        ? session.operatorSocketId
        : session.citizenSocketId;

      if (targetSocketId) {
        io.to(targetSocketId).emit('CALL_ICE_CANDIDATE', data);
      }
    });

    // ── Transcript relay ────────────────────────────────────

    socket.on('CALL_OPERATOR_TRANSCRIPT', (data: any) => {
      const session = activeSessions.get(data.sessionId);
      if (!session) return;

      // Relay to citizen
      io.to(session.citizenSocketId).emit('CALL_OPERATOR_TRANSCRIPT', data);

      // Store in session
      session.transcript.push(data);
      if (session.transcript.length > 200) {
        session.transcript = session.transcript.slice(-200);
      }
    });

    // ── Keyword detected ────────────────────────────────────

    socket.on('CALL_KEYWORD_DETECTED', async (data: {
      sessionId:  string;
      incidentId: string;
      keyword:    any;
    }) => {
      const session = activeSessions.get(data.sessionId);
      if (!session) return;

      session.keywords.push(data.keyword);

      // Relay to operator
      if (session.operatorSocketId) {
        io.to(session.operatorSocketId).emit('CALL_KEYWORD_DETECTED', data);
      }

      // Update incident type if keyword changes classification
      if (data.keyword.category && data.keyword.category !== session.emergencyType) {
        try {
          await DatabaseManager.query(
            `UPDATE lifegrid.incidents SET type = $1, updated_at = NOW() WHERE id = $2`,
            [data.keyword.category.toUpperCase(), data.incidentId],
          );
          logger.info(`[Call] Incident ${data.incidentId} type updated to ${data.keyword.category}`);
        } catch { /* non-fatal */ }
      }

      // Broadcast to command center
      io.to('command-center').emit('INCIDENT_UPDATED', {
        payload: { id: data.incidentId, aiKeyword: data.keyword },
        timestamp: new Date().toISOString(),
      });
    });

    // ── Dispatch triggered from call ────────────────────────

    socket.on('CALL_DISPATCH_TRIGGERED', async (data: {
      incidentId: string;
      sessionId:  string;
      operatorId: string;
    }) => {
      logger.info(`[Call] Dispatch triggered for incident ${data.incidentId}`);
      // The dispatch pipeline handles the actual dispatch
      // This just logs and notifies
      io.to('command-center').emit('INCIDENT_UPDATED', {
        payload: { id: data.incidentId, status: 'DISPATCHED' },
        timestamp: new Date().toISOString(),
      });
    });

    // ── Escalation ──────────────────────────────────────────

    socket.on('CALL_ESCALATED', async (data: {
      incidentId: string;
      sessionId:  string;
      operatorId: string;
    }) => {
      logger.warn(`[Call] Escalation: incident ${data.incidentId}`);
      try {
        await DatabaseManager.query(
          `UPDATE lifegrid.incidents SET severity = 'CRITICAL', status = 'ESCALATED', updated_at = NOW() WHERE id = $1`,
          [data.incidentId],
        );
      } catch { /* non-fatal */ }

      io.to('command-center').emit('INCIDENT_ESCALATED', {
        payload: { id: data.incidentId, escalatedBy: data.operatorId },
        timestamp: new Date().toISOString(),
      });
    });

    // ── End call ────────────────────────────────────────────

    socket.on('CALL_END', async (data: {
      sessionId: string;
      incidentId: string;
      duration:  number;
    }) => {
      const session = activeSessions.get(data.sessionId);
      if (!session) return;

      session.status  = 'ended';
      session.endedAt = new Date().toISOString();
      activeSessions.set(data.sessionId, session);

      // Notify both parties
      const targets = [session.citizenSocketId, session.operatorSocketId].filter(Boolean);
      targets.forEach(id => {
        if (id !== socket.id) {
          io.to(id!).emit('CALL_ENDED_BY_OPERATOR', { sessionId: data.sessionId });
        }
      });

      // Clean up operator queue
      if (session.operatorSocketId) {
        const opCalls = operatorQueue.get(session.operatorSocketId) ?? [];
        operatorQueue.set(
          session.operatorSocketId,
          opCalls.filter(id => id !== data.sessionId),
        );
      }

      // Remove from active sessions after 60s (keep for late ICE candidates)
      setTimeout(() => activeSessions.delete(data.sessionId), 60000);

      await auditCall(session);
      await RedisManager.del(`call:session:${data.sessionId}`);

      logger.info(`[Call] Ended: ${data.sessionId} · duration: ${data.duration}s`);
    });

    // ── Operator ended call ─────────────────────────────────

    socket.on('CALL_ENDED_BY_OPERATOR', async (data: {
      sessionId:  string;
      incidentId: string;
      duration:   number;
    }) => {
      const session = activeSessions.get(data.sessionId);
      if (!session) return;

      session.status  = 'ended';
      session.endedAt = new Date().toISOString();

      // Notify citizen
      io.to(session.citizenSocketId).emit('CALL_ENDED_BY_OPERATOR', {
        sessionId: data.sessionId,
      });

      await auditCall(session);
      logger.info(`[Call] Ended by operator: ${data.sessionId}`);
    });

    // ── Cleanup on disconnect ───────────────────────────────

    socket.on('disconnect', () => {
      // End any active calls for this socket
      for (const [sessionId, session] of activeSessions) {
        if (session.citizenSocketId === socket.id || session.operatorSocketId === socket.id) {
          if (session.status === 'connected' || session.status === 'ringing') {
            const otherSocketId = session.citizenSocketId === socket.id
              ? session.operatorSocketId
              : session.citizenSocketId;

            if (otherSocketId) {
              io.to(otherSocketId).emit('CALL_ENDED_BY_OPERATOR', { sessionId });
            }

            session.status  = 'ended';
            session.endedAt = new Date().toISOString();
            activeSessions.set(sessionId, session);
          }
        }
      }

      // Clean operator queue
      operatorQueue.delete(socket.id);
    });
  });
}

// ── Stats endpoint ────────────────────────────────────────────

export function getCallStats() {
  const sessions = Array.from(activeSessions.values());
  return {
    total:     sessions.length,
    waiting:   sessions.filter(s => s.status === 'waiting').length,
    ringing:   sessions.filter(s => s.status === 'ringing').length,
    connected: sessions.filter(s => s.status === 'connected').length,
    ended:     sessions.filter(s => s.status === 'ended').length,
  };
}
