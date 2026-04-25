import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MapPin, Clock, CheckCircle, Circle, Loader, ArrowLeft, Phone } from 'lucide-react';
import { useSocket } from '../hooks/useSocket';
import { api } from '../lib/api';
import { IncidentMap } from '../components/map/IncidentMap';

interface TimelineStep {
  step: number;
  name: string;
  timestamp: string | null;
  status: 'complete' | 'active' | 'pending';
}

interface ResponderLocation {
  responderId: string;
  lat: number;
  lng: number;
  timestamp: string;
}

export default function TrackingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { socket } = useSocket();

  const [incident, setIncident] = useState<any>(null);
  const [timeline, setTimeline] = useState<TimelineStep[]>([]);
  const [responderLocations, setResponderLocations] = useState<ResponderLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [eta, setEta] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;

    const fetchData = async () => {
      try {
        const [incidentRes, timelineRes] = await Promise.all([
          api.get(`/incidents/${id}`),
          api.get(`/incidents/${id}/timeline`),
        ]);
        setIncident(incidentRes.data.data);
        setTimeline(timelineRes.data.data);

        // Calculate ETA from AI decision
        const aiDecision = incidentRes.data.data?.aiDecision;
        if (aiDecision?.estimatedResponseTime) {
          const createdAt = new Date(incidentRes.data.data.createdAt).getTime();
          const etaMs = createdAt + aiDecision.estimatedResponseTime * 1000;
          const remainingSeconds = Math.max(0, Math.round((etaMs - Date.now()) / 1000));
          setEta(remainingSeconds);
        }
      } catch (err) {
        console.error('Failed to fetch incident:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  // Real-time updates via WebSocket
  useEffect(() => {
    if (!socket || !id) return;

    socket.emit('JOIN_INCIDENT', id);

    socket.on('INCIDENT_UPDATED', (event: any) => {
      if (event.payload?.id === id) {
        setIncident(event.payload);
      }
    });

    socket.on('RESPONDER_LOCATION_UPDATE', (event: any) => {
      setResponderLocations(prev => {
        const filtered = prev.filter(r => r.responderId !== event.payload.responderId);
        return [...filtered, event.payload];
      });
    });

    return () => {
      socket.emit('LEAVE_INCIDENT', id);
      socket.off('INCIDENT_UPDATED');
      socket.off('RESPONDER_LOCATION_UPDATE');
    };
  }, [socket, id]);

  // ETA countdown
  useEffect(() => {
    if (eta === null || eta <= 0) return;
    const interval = setInterval(() => setEta(prev => (prev !== null ? Math.max(0, prev - 1) : null)), 1000);
    return () => clearInterval(interval);
  }, [eta]);

  const formatEta = (seconds: number): string => {
    if (seconds <= 0) return 'Arriving now';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const getSeverityColor = (severity: string) => {
    const map: Record<string, string> = {
      CRITICAL: '#ff2d2d', HIGH: '#ff8c00', MEDIUM: '#ffd700', LOW: '#00ff88',
    };
    return map[severity] ?? '#888';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader className="w-6 h-6 animate-spin text-[#555]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">

      {/* Header */}
      <header className="border-b border-[#1a1a1a] px-4 py-3 flex items-center gap-4">
        <button onClick={() => navigate('/')} className="p-2 hover:bg-[#111] transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <div className="text-xs font-bold tracking-widest uppercase">Incident Tracking</div>
          <div className="text-[10px] font-mono text-[#555]">{incident?.referenceCode}</div>
        </div>
        {incident?.severity && (
          <div
            className="px-3 py-1 text-[10px] font-bold tracking-widest uppercase border"
            style={{ borderColor: getSeverityColor(incident.severity), color: getSeverityColor(incident.severity) }}
          >
            {incident.severity}
          </div>
        )}
      </header>

      {/* Map */}
      <div className="h-56 border-b border-[#111]">
        <IncidentMap
          center={incident?.location ?? { lat: 40.7128, lng: -74.006 }}
          zoom={14}
          markerPosition={incident?.location}
          responderLocations={responderLocations}
          readonly
        />
      </div>

      {/* ETA Banner */}
      {eta !== null && incident?.status !== 'CLOSED' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="border-b border-[#1a1a1a] px-6 py-4 flex items-center justify-between bg-[#0a0a0a]"
        >
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-[#888]" />
            <div>
              <div className="text-[10px] text-[#555] tracking-widest uppercase">Estimated Arrival</div>
              <div className="text-xl font-mono font-bold">{formatEta(eta)}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-[#555] tracking-widest uppercase">Status</div>
            <div className="text-sm font-bold">{incident?.status?.replace('_', ' ')}</div>
          </div>
        </motion.div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="text-[10px] text-[#555] tracking-widest uppercase mb-6">Response Timeline</div>

        <div className="space-y-0">
          {timeline.map((step, i) => (
            <motion.div
              key={step.step}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex gap-4"
            >
              {/* Connector */}
              <div className="flex flex-col items-center">
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  step.status === 'complete'
                    ? 'border-white bg-white'
                    : step.status === 'active'
                    ? 'border-white bg-transparent'
                    : 'border-[#333] bg-transparent'
                }`}>
                  {step.status === 'complete' ? (
                    <CheckCircle className="w-3 h-3 text-black" />
                  ) : step.status === 'active' ? (
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  ) : (
                    <Circle className="w-3 h-3 text-[#333]" />
                  )}
                </div>
                {i < timeline.length - 1 && (
                  <div className={`w-px flex-1 my-1 ${step.status === 'complete' ? 'bg-[#333]' : 'bg-[#1a1a1a]'}`} />
                )}
              </div>

              {/* Content */}
              <div className="pb-6 flex-1">
                <div className={`text-sm font-bold mb-1 ${
                  step.status === 'pending' ? 'text-[#333]' : 'text-white'
                }`}>
                  {step.name}
                </div>
                {step.timestamp ? (
                  <div className="text-[10px] font-mono text-[#555]">
                    {new Date(step.timestamp).toLocaleTimeString()}
                  </div>
                ) : step.status === 'active' ? (
                  <div className="text-[10px] text-[#888] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#888] animate-pulse" />
                    In progress...
                  </div>
                ) : (
                  <div className="text-[10px] text-[#333]">Pending</div>
                )}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Emergency contact */}
        <div className="mt-8 border border-[#1a1a1a] p-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold mb-1">Need immediate help?</div>
            <div className="text-[10px] text-[#555]">Call emergency services directly</div>
          </div>
          <a
            href="tel:911"
            className="flex items-center gap-2 px-4 py-2 border border-white text-xs font-bold tracking-widest uppercase hover:bg-white hover:text-black transition-colors"
          >
            <Phone className="w-3 h-3" /> Call 911
          </a>
        </div>
      </div>
    </div>
  );
}
