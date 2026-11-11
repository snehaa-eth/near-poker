'use client';

import { useCallback, useMemo, useState } from 'react';

import { type SessionUser, api } from '~/lib/api';
import { defaultAvatarForAddress } from '~/lib/avatars';
import { nicknameFromAddress } from '~/lib/near/address';
import {
  CHIPS_PER_NEAR,
  chipsFromNear,
  chipsToYocto,
  nearFromChips,
  nearToYocto,
} from '~/lib/treasury';

import { useNearWallet } from '~/providers/near-wallet-provider';
import { useSession } from '~/providers/session-provider';

/**
 * Off-chain gaming wallet (session chips).
 * Play poker with `chips`; deposit/withdraw go through the table-vault
 * contract when NEXT_PUBLIC_VAULT_ID is set, then sync via treasury APIs.
 */
export function useGamingWallet() {
  const { user, loading, refresh, upsertProfile } = useSession();
  const {
    isConnected,
    isConnecting,
    connect,
    walletStatus,
    address,
    vaultId,
    callVault,
  } = useNearWallet();

  const chips = user?.chips ?? 0;
  const nearBalance = useMemo(() => nearFromChips(chips), [chips]);

  const ensureSession = useCallback(async (): Promise<
    SessionUser & { walletAddress: string }
  > => {
    if (user?.walletAddress && address && user.walletAddress === address) {
      return user as SessionUser & { walletAddress: string };
    }

    let wallet = address;
    if (!isConnected || !wallet) {
      if (walletStatus === 'not-found') {
        throw new Error(
          'NEAR wallet selector failed to load. Refresh and retry.'
        );
      }
      wallet = await connect();
    }
    if (!wallet) {
      throw new Error('Wallet connection cancelled.');
    }

    const me = await upsertProfile({
      walletAddress: wallet,
      nickname: user?.nickname ?? nicknameFromAddress(wallet),
      avatar: user?.avatar ?? defaultAvatarForAddress(wallet),
    });
    await refresh();
    return { ...me, walletAddress: wallet };
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
    nearBalance,
    chipsPerNear: CHIPS_PER_NEAR,
    isConnected,
    isConnecting,
    walletStatus,
    address,
    vaultId,
    onChain: Boolean(vaultId),
    callVault,
    refresh,
    ensureSession,
    connect,
    chipsFromNear,
    nearFromChips,
  };
}

export type DepositResult = Awaited<ReturnType<typeof api.treasuryDeposit>> & {
  txHash: string | null;
};

/** Deposit NEAR into table-vault (if configured), then credit session chips. */
export function useDeposit() {
  const gaming = useGamingWallet();
  const { ensureSession, refresh, callVault, onChain } = gaming;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useCallback((nearAmount: number) => {
    if (!Number.isFinite(nearAmount) || nearAmount <= 0) {
      return { chipsAdded: 0, nearAmount: 0 };
    }
    return { nearAmount, chipsAdded: chipsFromNear(nearAmount) };
  }, []);

  const deposit = useCallback(
    async (nearAmount: number): Promise<DepositResult> => {
      if (!Number.isFinite(nearAmount) || nearAmount <= 0) {
        throw new Error('Enter a positive NEAR amount');
      }
      setPending(true);
      setError(null);
      try {
        await ensureSession();
        const yocto = nearToYocto(String(nearAmount));
        let txHash: string | null = null;
        if (onChain) {
          ({ txHash } = await callVault({
            methodName: 'deposit',
            args: {},
            depositYocto: yocto,
          }));
        }
        const result = await api.treasuryDeposit({ nearAmount, yocto, txHash });
        await refresh();
        return { ...result, txHash };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Deposit failed';
        setError(message);
        throw err;
      } finally {
        setPending(false);
      }
    },
    [ensureSession, refresh, callVault, onChain]
  );

  return { ...gaming, pending, error, preview, deposit };
}

export type WithdrawResult = Awaited<
  ReturnType<typeof api.treasuryWithdraw>
> & {
  txHash: string | null;
};

/** Withdraw from table-vault (if configured), then debit session chips. */
export function useWithdraw() {
  const gaming = useGamingWallet();
  const { ensureSession, refresh, chips, callVault, onChain } = gaming;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useCallback(
    (chipAmount: number) => {
      if (!Number.isFinite(chipAmount) || chipAmount <= 0) return null;
      const chipsOut = Math.floor(chipAmount);
      if (chipsOut <= 0) return null;
      return {
        chipsOut,
        nearOut: nearFromChips(chipsOut),
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
        throw new Error(`Insufficient chips. Need ${chipsOut}, have ${chips}.`);
      }
      setPending(true);
      setError(null);
      try {
        await ensureSession();
        const yocto = chipsToYocto(chipsOut);
        let txHash: string | null = null;
        if (onChain) {
          ({ txHash } = await callVault({
            methodName: 'withdraw',
            args: { amount: yocto },
          }));
        }
        const result = await api.treasuryWithdraw({
          chipsAmount: chipsOut,
          yocto,
          txHash,
        });
        await refresh();
        return { ...result, txHash };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Withdraw failed';
        setError(message);
        throw err;
      } finally {
        setPending(false);
      }
    },
    [ensureSession, refresh, chips, callVault, onChain]
  );

  return { ...gaming, pending, error, preview, withdraw };
}
