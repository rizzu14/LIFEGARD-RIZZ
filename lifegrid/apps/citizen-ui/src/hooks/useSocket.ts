import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:4000';

interface UseSocketReturn {
  socket: Socket | null;
  connected: boolean;
}

export function useSocket(): UseSocketReturn {
  const { token } = useAuthStore();
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(WS_URL, {
      auth: token ? { token } : undefined,
      query: !token ? { mode: 'citizen' } : undefined,
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 3000,
      timeout: 5000,
    });

    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => {
      // Backend not running — that's fine for UI preview
      setConnected(false);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [token]);

  return { socket: socketRef.current, connected };
}
