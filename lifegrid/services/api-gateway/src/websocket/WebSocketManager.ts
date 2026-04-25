// ============================================================
// LIFEGRID – WebSocket Manager
// Real-time event distribution to operators and citizens
// ============================================================

import { Server as SocketIOServer, Socket } from 'socket.io';
import { WSEventType, WSEvent, UserRole } from '@lifegrid/shared-types';
import { logger } from '../utils/logger';
import { verifyToken } from '../utils/jwt';
import { RedisManager } from '../cache/RedisManager';

interface ConnectedClient {
  socketId: string;
  userId: string;
  role: UserRole;
  rooms: string[];
  connectedAt: string;
  lastPing: string;
}

export class WebSocketManager {
  private static io: SocketIOServer;
  private static clients = new Map<string, ConnectedClient>();

  static initialize(io: SocketIOServer): void {
    this.io = io;
    this.setupMiddleware();
    this.setupEventHandlers();
    logger.info('✅ WebSocketManager initialized');
  }

  private static setupMiddleware(): void {
    // JWT authentication for WebSocket connections
    this.io.use(async (socket: Socket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ??
          socket.handshake.headers?.authorization?.replace('Bearer ', '');

        if (!token) {
          // Allow unauthenticated connections for citizen panic button
          if (socket.handshake.query?.mode === 'citizen') {
            socket.data.role = UserRole.CITIZEN;
            socket.data.userId = `anon:${socket.id}`;
            return next();
          }
          return next(new Error('Authentication required'));
        }

        const payload = verifyToken(token);
        socket.data.userId = payload.userId;
        socket.data.role = payload.role;
        next();
      } catch (err) {
        next(new Error('Invalid token'));
      }
    });
  }

  private static setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      const client: ConnectedClient = {
        socketId: socket.id,
        userId: socket.data.userId,
        role: socket.data.role,
        rooms: [],
        connectedAt: new Date().toISOString(),
        lastPing: new Date().toISOString(),
      };

      this.clients.set(socket.id, client);
      logger.info(`[WS] Client connected: ${socket.data.userId} (${socket.data.role})`);

      // Auto-join role-based rooms
      socket.join(`role:${socket.data.role}`);
      socket.join(`user:${socket.data.userId}`);
      client.rooms.push(`role:${socket.data.role}`, `user:${socket.data.userId}`);

      // Operators and commanders join the command room
      if ([UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.COMMANDER, UserRole.SYSTEM_ADMIN].includes(socket.data.role)) {
        socket.join('command-center');
        client.rooms.push('command-center');
      }

      // ── Client-initiated events ───────────────────────────

      socket.on('JOIN_INCIDENT', (incidentId: string) => {
        socket.join(`incident:${incidentId}`);
        client.rooms.push(`incident:${incidentId}`);
        logger.debug(`[WS] ${socket.data.userId} joined incident room ${incidentId}`);
      });

      socket.on('LEAVE_INCIDENT', (incidentId: string) => {
        socket.leave(`incident:${incidentId}`);
        client.rooms = client.rooms.filter(r => r !== `incident:${incidentId}`);
      });

      socket.on('RESPONDER_LOCATION', async (data: { lat: number; lng: number; incidentId?: string }) => {
        if (socket.data.role !== UserRole.RESPONDER) return;
        await RedisManager.set(
          `responder:location:${socket.data.userId}`,
          JSON.stringify({ ...data, timestamp: new Date().toISOString() }),
          300,
        );
        this.io.to('command-center').emit('RESPONDER_LOCATION_UPDATE', {
          responderId: socket.data.userId,
          ...data,
          timestamp: new Date().toISOString(),
        });
      });

      socket.on('PING', () => {
        client.lastPing = new Date().toISOString();
        socket.emit('PONG', { timestamp: new Date().toISOString() });
      });

      socket.on('OPERATOR_BROADCAST', (data: { message: string; severity: string }) => {
        if (![UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.COMMANDER].includes(socket.data.role)) return;
        this.broadcast('OPERATOR_BROADCAST', {
          operatorId: socket.data.userId,
          ...data,
          timestamp: new Date().toISOString(),
        });
      });

      socket.on('disconnect', (reason) => {
        this.clients.delete(socket.id);
        logger.info(`[WS] Client disconnected: ${socket.data.userId} (${reason})`);
      });

      // Send initial system state to operators
      if (socket.data.role !== UserRole.CITIZEN) {
        socket.emit('SYSTEM_STATE', {
          connectedClients: this.clients.size,
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  // ── Broadcast methods ─────────────────────────────────────

  static broadcast(event: WSEventType, payload: unknown): void {
    const wsEvent: WSEvent = {
      event,
      payload,
      timestamp: new Date().toISOString(),
    };
    this.io.emit(event, wsEvent);
    logger.debug(`[WS] Broadcast: ${event}`);
  }

  static broadcastToRoom(room: string, event: WSEventType, payload: unknown): void {
    const wsEvent: WSEvent = {
      event,
      payload,
      timestamp: new Date().toISOString(),
    };
    this.io.to(room).emit(event, wsEvent);
  }

  static broadcastToIncident(incidentId: string, event: WSEventType, payload: unknown): void {
    this.broadcastToRoom(`incident:${incidentId}`, event, payload);
  }

  static broadcastToCommandCenter(event: WSEventType, payload: unknown): void {
    this.broadcastToRoom('command-center', event, payload);
  }

  static sendToUser(userId: string, event: WSEventType, payload: unknown): void {
    this.broadcastToRoom(`user:${userId}`, event, payload);
  }

  static getConnectedCount(): number {
    return this.clients.size;
  }

  static getClientsByRole(role: UserRole): ConnectedClient[] {
    return Array.from(this.clients.values()).filter(c => c.role === role);
  }
}
