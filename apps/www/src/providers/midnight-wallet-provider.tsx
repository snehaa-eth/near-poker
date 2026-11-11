'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import '@midnight-ntwrk/dapp-connector-api';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';

import { env } from '~/env';
import { selectWallet, waitForWallet } from '~/lib/midnight/select-wallet';
import { sumBalances } from '~/lib/midnight/balances';

export type MidnightNetworkId =
  | 'undeployed'
  | 'preview'
  | 'preprod'
  | 'mainnet';

export type WalletBalances = {
  unshieldedStars: bigint;
  shieldedStars: bigint;
  dustBalance: bigint;
  dustCap: bigint;
};

type WalletStatus = 'checking' | 'detected' | 'not-found';

type MidnightWalletContextValue = {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  ready: boolean;
  walletStatus: WalletStatus;
  walletName: string | null;
  networkId: MidnightNetworkId;
  api: ConnectedAPI | null;
  balances: WalletBalances | null;
  balancesLoading: boolean;
  connect: (network?: MidnightNetworkId) => Promise<string | null>;
  disconnect: () => void;
  refreshBalances: () => Promise<WalletBalances | null>;
};

const MidnightWalletContext =
  createContext<MidnightWalletContextValue | null>(null);

const DEFAULT_NETWORK =
  (env.NEXT_PUBLIC_MIDNIGHT_NETWORK as MidnightNetworkId) ?? 'preprod';

const STORAGE_KEY = 'midnight.wallet.session';

type StoredSession = {
  connected: true;
  networkId: MidnightNetworkId;
  address?: string;
};

const EMPTY_BALANCES: WalletBalances = {
  unshieldedStars: 0n,
  shieldedStars: 0n,
  dustBalance: 0n,
  dustCap: 0n,
};

function readStoredSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.connected) return null;
    return {
      connected: true,
      networkId: parsed.networkId || DEFAULT_NETWORK,
      address: parsed.address,
    };
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredSession | null) {
  if (typeof window === 'undefined') return;
  try {
    if (!session) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // ignore quota / private mode
  }
}

async function readBalances(api: ConnectedAPI): Promise<WalletBalances> {
  const [unshielded, shielded, dust] = await Promise.all([
    api.getUnshieldedBalances(),
    api.getShieldedBalances(),
    api.getDustBalance(),
  ]);
  return {
    unshieldedStars: sumBalances(unshielded),
    shieldedStars: sumBalances(shielded),
    dustBalance: dust.balance,
    dustCap: dust.cap,
  };
}

export function MidnightWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletStatus, setWalletStatus] = useState<WalletStatus>('checking');
  const [walletName, setWalletName] = useState<string | null>(null);
  const [api, setApi] = useState<ConnectedAPI | null>(null);
  const [networkId, setNetworkId] =
    useState<MidnightNetworkId>(DEFAULT_NETWORK);
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  /** Stay "not ready" until wallet probe + optional silent reconnect finish. */
  const [bootstrapped, setBootstrapped] = useState(false);
  const connectingRef = useRef(false);
  const restoredRef = useRef(false);

  const applyConnected = useCallback(
    async (
      connectedApi: ConnectedAPI,
      unshieldedAddress: string,
      network: MidnightNetworkId
    ) => {
      setApi(connectedApi);
      setAddress(unshieldedAddress);
      setIsConnected(true);
      setNetworkId(network);
      writeStoredSession({
        connected: true,
        networkId: network,
        address: unshieldedAddress,
      });

      try {
        setBalancesLoading(true);
        setBalances(await readBalances(connectedApi));
      } catch (error) {
        console.warn('Failed to load wallet balances', error);
        setBalances(EMPTY_BALANCES);
      } finally {
        setBalancesLoading(false);
      }
    },
    []
  );

  const connect = useCallback(
    async (network: MidnightNetworkId = DEFAULT_NETWORK) => {
      if (connectingRef.current) return null;
      connectingRef.current = true;
      setIsConnecting(true);
      try {
        const wallet = selectWallet();
        setWalletName(wallet.name ?? 'Midnight wallet');
        setWalletStatus('detected');

        const connectedApi = await wallet.connect(network);
        const { unshieldedAddress } = await connectedApi.getUnshieldedAddress();
        const status = await connectedApi.getConnectionStatus();

        if (status.status !== 'connected') {
          throw new Error('Wallet connection was not authorized.');
        }

        await applyConnected(connectedApi, unshieldedAddress, network);
        return unshieldedAddress;
      } finally {
        connectingRef.current = false;
        setIsConnecting(false);
      }
    },
    [applyConnected]
  );

  const disconnect = useCallback(() => {
    writeStoredSession(null);
    setAddress(null);
    setIsConnected(false);
    setApi(null);
    setBalances(null);
  }, []);

  // Detect wallet + silently restore prior session on refresh.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const wallet = await waitForWallet();
      if (cancelled) return;

      if (!wallet) {
        setWalletStatus('not-found');
        setBootstrapped(true);
        return;
      }

      setWalletStatus('detected');
      setWalletName(wallet.name ?? 'Midnight wallet');

      const stored = readStoredSession();
      if (!stored || restoredRef.current) {
        setBootstrapped(true);
        return;
      }
      restoredRef.current = true;

      try {
        setIsConnecting(true);
        const connectedApi = await wallet.connect(stored.networkId);
        if (cancelled) return;

        const { unshieldedAddress } = await connectedApi.getUnshieldedAddress();
        const status = await connectedApi.getConnectionStatus();

        if (status.status !== 'connected') {
          writeStoredSession(null);
          return;
        }

        await applyConnected(
          connectedApi,
          unshieldedAddress,
          stored.networkId
        );
      } catch (error) {
        console.warn('Silent wallet restore failed', error);
        // Keep the preference so a later manual connect can retry; only
        // clear if the wallet explicitly rejected / is gone.
        if (
          error instanceof Error &&
          /not authorized|rejected|denied|not found/i.test(error.message)
        ) {
          writeStoredSession(null);
        }
      } finally {
        if (!cancelled) {
          setIsConnecting(false);
          setBootstrapped(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyConnected]);

  const refreshBalances = useCallback(async () => {
    if (!api) {
      setBalances(null);
      return null;
    }
    setBalancesLoading(true);
    try {
      const next = await readBalances(api);
      setBalances(next);
      return next;
    } catch (error) {
      console.warn('Failed to load wallet balances', error);
      setBalances(EMPTY_BALANCES);
      return EMPTY_BALANCES;
    } finally {
      setBalancesLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api || !isConnected) {
      setBalances(null);
      return;
    }
    void refreshBalances();
  }, [api, isConnected, refreshBalances]);

  const value = useMemo(
    () => ({
      address,
      isConnected,
      isConnecting,
      ready: bootstrapped,
      walletStatus,
      walletName,
      networkId,
      api,
      balances,
      balancesLoading,
      connect,
      disconnect,
      refreshBalances,
    }),
    [
      address,
      isConnected,
      isConnecting,
      bootstrapped,
      walletStatus,
      walletName,
      networkId,
      api,
      balances,
      balancesLoading,
      connect,
      disconnect,
      refreshBalances,
    ]
  );

  return (
    <MidnightWalletContext.Provider value={value}>
      {children}
    </MidnightWalletContext.Provider>
  );
}

export function useMidnightWallet(): MidnightWalletContextValue {
  const ctx = useContext(MidnightWalletContext);
  if (!ctx) {
    throw new Error('useMidnightWallet must be used within MidnightWalletProvider');
  }
  return ctx;
}
