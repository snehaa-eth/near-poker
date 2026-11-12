'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { api, type NearProofBody, type SessionUser } from '~/lib/api';
import { errorHandler } from '~/lib/utils';

import { toast } from 'sonner';

type ProfileInput = {
  walletAddress: string;
  nickname?: string;
  avatar?: string | null;
  nearProof?: NearProofBody;
};

type SessionContextValue = {
  /** Starts the /auth/me probe the first time a consumer needs it. */
  ensure: () => void;
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setNickname: (nickname: string) => Promise<void>;
  upsertProfile: (input: ProfileInput) => Promise<SessionUser>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export const SessionProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Spectator pages never need a session, so we only probe /auth/me when a
  // component actually asks for it (avoids a 401 on every page view).
  const started = React.useRef(false);
  const ensure = useCallback(() => {
    if (started.current) return;
    started.current = true;
    void refresh();
  }, [refresh]);

  const setNickname = useCallback(async (nickname: string) => {
    try {
      const me = await api.setNickname(nickname);
      setUser(me);
      toast.success(`Welcome, ${me.nickname}!`);
    } catch (error) {
      toast.error(errorHandler(error));
      throw error;
    }
  }, []);

  const upsertProfile = useCallback(async (input: ProfileInput) => {
    const me = await api.upsertProfile(input);
    setUser(me);
    return me;
  }, []);

  const value = useMemo(
    () => ({ ensure, user, loading, refresh, setNickname, upsertProfile }),
    [ensure, user, loading, refresh, setNickname, upsertProfile]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
};

export const useSession = () => {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  const { ensure } = ctx;
  useEffect(() => {
    ensure();
  }, [ensure]);
  return ctx;
};

/** Read the session without triggering the /auth/me probe. */
export const useSessionPassive = () => {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
};
