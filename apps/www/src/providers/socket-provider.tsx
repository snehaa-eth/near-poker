'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { env } from '~/env';
import { useSession } from '~/providers/session-provider';

import { io, type Socket } from 'socket.io-client';

type SocketContextValue = {
  socket: Socket | null;
  connected: boolean;
};

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
});

export const SocketProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { user } = useSession();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Connect even when logged out so visitors can spectate tables (server rejects their actions).
    const s = io(env.NEXT_PUBLIC_WS_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    setSocket(s);

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.disconnect();
    };
  }, [user?.sessionId]);

  const value = useMemo(
    () => ({ socket, connected }),
    [socket, connected]
  );

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
