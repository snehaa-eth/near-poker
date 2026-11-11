'use client';

import { useCallback, useMemo, useState } from 'react';

import { api, type SessionUser } from '~/lib/api';
import { defaultAvatarForAddress } from '~/lib/avatars';
import { nicknameFromAddress } from '~/lib/midnight/address';
import {
  CHIPS_PER_NIGHT,
  chipsFromNight,
  nightFromChips,
  quoteWithdrawNight,
} from '~/lib/treasury';
import { useMidnightWallet } from '~/providers/midnight-wallet-provider';
import { useSession } from '~/providers/session-provider';

/**
 * Off-chain gaming wallet (MongoDB session chips).
 * Play poker with `chips`; deposit/withdraw sync via treasury APIs.
 */
export function useGamingWallet() {
  const { user, loading, refresh, upsertProfile } = useSession();
  const {
    isConnected,
    isConnecting,
    connect,
    walletStatus,
    address,
  } = useMidnightWallet();

  const chips = user?.chips ?? 0;
  const nightBalance = useMemo(() => nightFromChips(chips), [chips]);

  const ensureSession = useCallback(async (): Promise<SessionUser> => {
    if (user?.walletAddress && address && user.walletAddress === address) {
      return user;
    }

    if (!isConnected || !address) {
      if (walletStatus === 'not-found') {
        throw new Error(
          'No Midnight wallet found. Install 1AM or Lace, then refresh.'
        );
      }
      await connect();
    }

    const wallet = address;
    if (!wallet) {
      throw new Error('Wallet address unavailable after connect.');
    }

    const me = await upsertProfile({
      walletAddress: wallet,
      nickname: user?.nickname ?? nicknameFromAddress(wallet),
      avatar: user?.avatar ?? defaultAvatarForAddress(wallet),
    });
    await refresh();
    return me;
  }, [
    user,
    isConnected,
    walletStatus,
    connect,
    address,
    upsertProfile,
    refresh,
  ]);

  return {
    user,
    loading,
    chips,
    nightBalance,
    chipsPerNight: CHIPS_PER_NIGHT,
    isConnected,
    isConnecting,
    walletStatus,
    address,
    refresh,
    ensureSession,
    connect,
    chipsFromNight,
    nightFromChips,
  };
}

export type DepositResult = Awaited<ReturnType<typeof api.treasuryDeposit>>;

/** Credit MongoDB chips after (or alongside) on-chain deposit. */
export function useDeposit() {
  const gaming = useGamingWallet();
  const { ensureSession, refresh } = gaming;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useCallback((nightAmount: number) => {
    if (!Number.isFinite(nightAmount) || nightAmount <= 0) {
      return { chipsAdded: 0, nightAmount: 0 };
    }
    return {
      nightAmount,
      chipsAdded: chipsFromNight(nightAmount),
    };
  }, []);

  const deposit = useCallback(
    async (nightAmount: number): Promise<DepositResult> => {
      if (!Number.isFinite(nightAmount) || nightAmount <= 0) {
        throw new Error('Enter a positive NIGHT amount');
      }
      setPending(true);
      setError(null);
      try {
        await ensureSession();
        // TODO: call Compact deposit() with connected wallet, then credit DB
        const result = await api.treasuryDeposit(nightAmount);
        await refresh();
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Deposit failed';
        setError(message);
        throw err;
      } finally {
        setPending(false);
      }
    },
    [ensureSession, refresh]
  );

  return {
    user: gaming.user,
    loading: gaming.loading,
    chips: gaming.chips,
    nightBalance: gaming.nightBalance,
    chipsPerNight: gaming.chipsPerNight,
    isConnected: gaming.isConnected,
    isConnecting: gaming.isConnecting,
    walletStatus: gaming.walletStatus,
    address: gaming.address,
    refresh: gaming.refresh,
    ensureSession: gaming.ensureSession,
    connect: gaming.connect,
    chipsFromNight: gaming.chipsFromNight,
    nightFromChips: gaming.nightFromChips,
    pending,
    error,
    preview,
    deposit,
  };
}

export type WithdrawResult = Awaited<ReturnType<typeof api.treasuryWithdraw>>;

/** Debit MongoDB chips and settle NIGHT on-chain (operator withdraw). */
export function useWithdraw() {
  const gaming = useGamingWallet();
  const { ensureSession, refresh, chips } = gaming;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useCallback(
    (chipAmount: number) => {
      if (!Number.isFinite(chipAmount) || chipAmount <= 0) {
        return null;
      }
      const chipsOut = Math.floor(chipAmount);
      if (chipsOut <= 0) return null;
      const grossNight =
        Math.round((chipsOut / CHIPS_PER_NIGHT) * 1_000_000) / 1_000_000;
      const quote = quoteWithdrawNight(grossNight);
      return {
        chipsOut,
        ...quote,
        canAfford: chipsOut <= chips,
      };
    },
    [chips]
  );

  const withdraw = useCallback(
    async (chipAmount: number): Promise<WithdrawResult> => {
      const chipsOut = Math.floor(chipAmount);
      if (!Number.isFinite(chipsOut) || chipsOut <= 0) {
        throw new Error('Enter a positive chip amount');
      }
      if (chipsOut > chips) {
        throw new Error(
          `Insufficient chips. Need ${chipsOut}, have ${chips}.`
        );
      }
      setPending(true);
      setError(null);
      try {
        await ensureSession();
        const result = await api.treasuryWithdraw({ chipsAmount: chipsOut });
        await refresh();
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Withdraw failed';
        setError(message);
        throw err;
      } finally {
        setPending(false);
      }
    },
    [ensureSession, refresh, chips]
  );

  return {
    user: gaming.user,
    loading: gaming.loading,
    chips: gaming.chips,
    nightBalance: gaming.nightBalance,
    chipsPerNight: gaming.chipsPerNight,
    isConnected: gaming.isConnected,
    isConnecting: gaming.isConnecting,
    walletStatus: gaming.walletStatus,
    address: gaming.address,
    refresh: gaming.refresh,
    ensureSession: gaming.ensureSession,
    connect: gaming.connect,
    chipsFromNight: gaming.chipsFromNight,
    nightFromChips: gaming.nightFromChips,
    pending,
    error,
    preview,
    withdraw,
  };
}
