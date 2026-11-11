'use client';

import Link from 'next/link';

import React, { useEffect, useRef, useState } from 'react';

import { LogOut } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '~/components/ui/button';
import { api } from '~/lib/api';
import { defaultAvatarForAddress } from '~/lib/avatars';
import { nicknameFromAddress, shortAddress } from '~/lib/near/address';
import { cn, errorHandler } from '~/lib/utils';
import { playSound } from '~/lib/sounds';
import { useNearWallet } from '~/providers/near-wallet-provider';
import { useSession } from '~/providers/session-provider';

export const ConnectButton = () => {
  const {
    ready,
    isConnected,
    isConnecting,
    address,
    walletStatus,
    connect,
    disconnect,
    signLoginMessage,
  } = useNearWallet();
  const { user: sessionUser, upsertProfile } = useSession();
  const [pending, setPending] = useState(false);
  const syncedWallet = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) return;
    if (syncedWallet.current === address) return;
    if (
      sessionUser?.walletAddress === address &&
      sessionUser.nickname &&
      sessionUser.avatar
    ) {
      syncedWallet.current = address;
      return;
    }
    syncedWallet.current = address;

    void (async () => {
      try {
        // New wallet for this session → try a NEP-413 signed login proof.
        // Unsupported wallets / rejections fall back to the plain upsert.
        let nearProof;
        if (sessionUser?.walletAddress !== address) {
          try {
            // The server issues the nonce so a signature can't be replayed.
            const { nonce } = await api.loginNonce();
            const bytes = Uint8Array.from(atob(nonce), (c) => c.charCodeAt(0));
            nearProof = (await signLoginMessage(bytes)) ?? undefined;
          } catch (error) {
            console.warn('NEP-413 login signature skipped', error);
          }
        }
        await upsertProfile({
          walletAddress: address,
          ...(nearProof ? { nearProof } : {}),
          ...(sessionUser?.nickname
            ? {}
            : { nickname: nicknameFromAddress(address) }),
          ...(sessionUser?.avatar
            ? {}
            : { avatar: defaultAvatarForAddress(address) }),
        });
      } catch (error) {
        syncedWallet.current = null;
        console.warn(errorHandler(error));
      }
    })();
  }, [
    isConnected,
    address,
    sessionUser?.walletAddress,
    sessionUser?.nickname,
    sessionUser?.avatar,
    upsertProfile,
    signLoginMessage,
  ]);

  const onConnect = async () => {
    setPending(true);
    try {
      if (walletStatus === 'not-found') {
        toast.error('NEAR wallet selector failed to load. Refresh and retry.');
        return;
      }
      const accountId = await connect();
      if (!accountId) return;
      playSound('gems');
      toast.success(`Connected ${accountId}`);
    } catch (error) {
      playSound('paajiLose');
      toast.error(errorHandler(error));
    } finally {
      setPending(false);
    }
  };

  const onDisconnect = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPending(true);
    try {
      disconnect();
      syncedWallet.current = null;
      playSound('cashout');
      toast.success('Wallet disconnected');
    } catch (error) {
      toast.error(errorHandler(error));
    } finally {
      setPending(false);
    }
  };

  if (!ready) {
    return (
      <Button
        disabled
        className='rounded-full border border-neutral-200 bg-white px-4 text-neutral-400'
        variant='outline'
      >
        Loading…
      </Button>
    );
  }

  if (isConnected && address) {
    const avatar =
      sessionUser?.avatar ?? defaultAvatarForAddress(address);
    const label = sessionUser?.nickname ?? shortAddress(address);

    return (
      <div className='flex max-w-[50vw] items-center gap-1 rounded-full border border-neutral-200 bg-white py-1 pl-1 pr-1 sm:max-w-none sm:pr-1.5'>
        <Link
          href='/profile'
          className='flex min-w-0 items-center gap-1 rounded-full pr-1'
        >
          <div className='h-7 w-7 shrink-0 overflow-hidden rounded-full bg-neutral-100'>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatar}
              alt=''
              className='h-full w-full object-cover'
            />
          </div>
          <div className='min-w-0 px-1'>
            <p className='truncate text-sm font-medium text-neutral-900'>
              {label}
            </p>
          </div>
        </Link>
        <button
          type='button'
          aria-label='Disconnect wallet'
          disabled={pending}
          onClick={onDisconnect}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900',
            pending && 'opacity-50'
          )}
        >
          <LogOut className='h-3.5 w-3.5' />
        </button>
      </div>
    );
  }

  return (
    <Button
      className='rounded-full bg-neutral-950 px-4 text-white hover:bg-neutral-800'
      disabled={pending || isConnecting}
      onClick={onConnect}
    >
      {pending || isConnecting ? 'Connecting…' : 'Connect wallet'}
    </Button>
  );
};
