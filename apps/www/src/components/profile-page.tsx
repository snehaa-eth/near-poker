'use client';

import Link from 'next/link';

import React, { useEffect, useState } from 'react';

import { Camera, Pencil, RefreshCw, Wallet } from 'lucide-react';
import { toast } from 'sonner';

import { AvatarPickerModal } from '~/components/avatar-picker-modal';
import { ChipAmount, NightAmount } from '~/components/currency-amount';
import { ProfileActivity } from '~/components/profile-activity';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import {
  defaultAvatarForAddress,
  type AvatarPath,
} from '~/lib/avatars';
import { formatTokens } from '~/lib/format';
import { shortAddress } from '~/lib/midnight/address';
import { formatNightFromStars } from '~/lib/midnight/balances';
import { CHIPS_PER_NIGHT } from '~/lib/treasury';
import { errorHandler } from '~/lib/utils';
import { useMidnightWallet } from '~/providers/midnight-wallet-provider';
import { useSession } from '~/providers/session-provider';

export const ProfilePage = () => {
  const {
    ready,
    isConnected,
    isConnecting,
    address,
    walletName,
    networkId,
    walletStatus,
    balances,
    balancesLoading,
    connect,
    refreshBalances,
  } = useMidnightWallet();
  const { user, loading: sessionLoading, upsertProfile } = useSession();

  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!address) return;
    setUsername(user?.nickname ?? '');
    setAvatar(user?.avatar ?? defaultAvatarForAddress(address));
  }, [address, user?.nickname, user?.avatar]);

  const onConnect = async () => {
    try {
      if (walletStatus === 'not-found') {
        toast.error(
          'No Midnight wallet found. Install 1AM or Lace, then refresh.'
        );
        return;
      }
      await connect();
      toast.success('Midnight wallet connected');
    } catch (error) {
      toast.error(errorHandler(error));
    }
  };

  const onRefreshBalances = async () => {
    try {
      await refreshBalances();
      toast.success('Balances updated');
    } catch (error) {
      toast.error(errorHandler(error));
    }
  };

  const saveProfile = async (next?: {
    nickname?: string;
    avatar?: string | null;
  }) => {
    if (!address) return;
    const nextName = (next?.nickname ?? username).trim();
    if (nextName.length < 2 || nextName.length > 24) {
      toast.error('Username must be 2–24 characters.');
      return;
    }
    setSaving(true);
    try {
      const me = await upsertProfile({
        walletAddress: address,
        nickname: nextName,
        avatar: next?.avatar !== undefined ? next.avatar : avatar,
      });
      setUsername(me.nickname);
      setAvatar(me.avatar);
      setEditingName(false);
      toast.success('Profile saved');
    } catch (error) {
      toast.error(errorHandler(error));
    } finally {
      setSaving(false);
    }
  };

  const onPickAvatar = async (next: AvatarPath) => {
    setAvatar(next);
    await saveProfile({ avatar: next });
  };

  if (!ready || sessionLoading) {
    return (
      <div className='mx-auto w-full max-w-6xl px-4 pb-16 pt-20 text-sm text-neutral-500 sm:px-6 sm:pt-24 lg:px-8'>
        Loading profile…
      </div>
    );
  }

  if (!isConnected || !address) {
    return (
      <div className='mx-auto flex w-full max-w-6xl flex-col items-start gap-4 px-4 pb-16 pt-20 sm:px-6 sm:pt-24 lg:px-8'>
        <p className='text-sm font-medium uppercase tracking-[0.18em] text-neutral-400'>
          Profile
        </p>
        <h1 className='font-poker text-3xl tracking-wide text-neutral-950 sm:text-5xl'>
          Connect a Midnight wallet to play
        </h1>
        <p className='text-sm text-neutral-600 sm:text-base'>
          Poker runs off-chain for speed. Your Midnight wallet is your table
          identity — username, avatar, and chips map to your address.
        </p>
        <Button
          className='rounded-full bg-neutral-950 px-5 text-white'
          disabled={isConnecting}
          onClick={onConnect}
        >
          {isConnecting ? 'Connecting…' : 'Connect wallet'}
        </Button>
      </div>
    );
  }

  const displayAvatar = avatar ?? defaultAvatarForAddress(address);
  const unshielded = balances
    ? formatNightFromStars(balances.unshieldedStars)
    : '—';
  const shielded = balances
    ? formatNightFromStars(balances.shieldedStars)
    : '—';
  const dust = balances ? balances.dustBalance : null;

  return (
    <div className='mx-auto w-full max-w-6xl px-4 pb-20 pt-20 sm:px-6 sm:pt-24 lg:px-8'>
      <p className='text-xs font-medium uppercase tracking-[0.18em] text-neutral-400 sm:text-sm'>
        Profile
      </p>
      <h1 className='mt-2 font-poker text-3xl tracking-wide text-neutral-950 sm:text-5xl'>
        Your table
      </h1>
      <p className='mt-2 max-w-xl text-sm text-neutral-600 sm:text-base'>
        Username and avatar are saved to your wallet address.
      </p>

      <section className='mt-6 border-y border-neutral-200 py-5 sm:mt-8'>
        <div className='flex items-start gap-3 sm:items-center sm:gap-4'>
          <button
            type='button'
            onClick={() => setAvatarOpen(true)}
            className='group relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-neutral-100 ring-2 ring-neutral-200 transition hover:ring-neutral-400 sm:h-16 sm:w-16'
            aria-label='Change avatar'
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayAvatar}
              alt=''
              className='h-full w-full object-cover'
            />
            <span className='absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100 group-active:opacity-100'>
              <Camera className='h-5 w-5 text-white' />
            </span>
          </button>

          <div className='min-w-0 flex-1'>
            {editingName ? (
              <div className='flex flex-col gap-2 sm:max-w-sm sm:flex-row sm:flex-wrap sm:items-center'>
                <Input
                  value={username}
                  maxLength={24}
                  autoFocus
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveProfile();
                    if (e.key === 'Escape') {
                      setUsername(user?.nickname ?? '');
                      setEditingName(false);
                    }
                  }}
                  placeholder='Username'
                  className='h-9 rounded-full'
                />
                <div className='flex gap-2'>
                  <Button
                    size='sm'
                    className='rounded-full bg-neutral-950 text-white'
                    disabled={saving}
                    onClick={() => void saveProfile()}
                  >
                    Save
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='rounded-full'
                    disabled={saving}
                    onClick={() => {
                      setUsername(user?.nickname ?? '');
                      setEditingName(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type='button'
                onClick={() => setEditingName(true)}
                className='group flex max-w-full items-center gap-1.5 text-left'
              >
                <p className='truncate text-base font-semibold text-neutral-950 sm:text-lg'>
                  {user?.nickname || username || 'Player'}
                </p>
                <Pencil className='h-3.5 w-3.5 shrink-0 text-neutral-400 opacity-70 transition group-hover:opacity-100 sm:opacity-0' />
              </button>
            )}
            <p className='mt-0.5 flex items-center gap-1.5 truncate text-xs text-neutral-500 sm:text-sm'>
              <Wallet className='h-3.5 w-3.5 shrink-0' />
              <span className='truncate'>{shortAddress(address)}</span>
            </p>
            <p className='mt-1 truncate text-[11px] text-neutral-400 sm:text-xs'>
              {walletName ?? 'Midnight wallet'} · {networkId}
            </p>
          </div>

          <div className='hidden shrink-0 text-right sm:block'>
            <p className='text-xs font-medium uppercase tracking-wide text-neutral-400'>
              Poker chips
            </p>
            <ChipAmount
              value={user?.chips ?? 0}
              size='md'
              className='mt-1 justify-end'
            />
            <button
              type='button'
              onClick={() => setAvatarOpen(true)}
              className='mt-1 text-xs font-medium text-[#1D9BF0] hover:underline'
            >
              Change avatar
            </button>
          </div>
        </div>

        <div className='mt-4 flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 sm:hidden'>
          <div>
            <p className='text-[11px] font-medium uppercase tracking-wide text-neutral-400'>
              Poker chips
            </p>
            <ChipAmount value={user?.chips ?? 0} size='md' className='mt-1' />
          </div>
          <button
            type='button'
            onClick={() => setAvatarOpen(true)}
            className='shrink-0 text-xs font-medium text-[#1D9BF0]'
          >
            Change avatar
          </button>
        </div>
      </section>

      <section className='mt-8'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
          <div className='min-w-0'>
            <h2 className='text-lg font-semibold text-neutral-950'>Balances</h2>
            <p className='mt-1 text-sm text-neutral-500'>
              1 NIGHT → {CHIPS_PER_NIGHT}× poker chips to play with.
            </p>
          </div>
          <Button
            variant='outline'
            size='sm'
            className='w-full rounded-full sm:w-auto'
            disabled={balancesLoading}
            onClick={onRefreshBalances}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${balancesLoading ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        </div>

        <div className='mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4'>
          <BalanceCard label='Poker chips'>
            <ChipAmount value={user?.chips ?? 0} size='lg' />
          </BalanceCard>
          <BalanceCard label='Unshielded NIGHT'>
            <NightAmount
              value={
                balancesLoading && !balances
                  ? '…'
                  : formatCompactNight(unshielded)
              }
              size='lg'
              raw
            />
          </BalanceCard>
          <BalanceCard label='Shielded NIGHT'>
            <NightAmount
              value={
                balancesLoading && !balances
                  ? '…'
                  : formatCompactNight(shielded)
              }
              size='lg'
              raw
            />
          </BalanceCard>
          <BalanceCard label='DUST'>
            <p className='mt-2 text-xl font-semibold tracking-tight tabular-nums text-neutral-950 sm:text-2xl'>
              {balancesLoading && !balances
                ? '…'
                : dust != null
                  ? formatTokens(dust)
                  : '—'}
            </p>
            {dust != null && balances ? (
              <p className='mt-1 text-[11px] tabular-nums text-neutral-400 sm:text-xs'>
                Cap {formatTokens(balances.dustCap)}
              </p>
            ) : null}
          </BalanceCard>
        </div>
      </section>

      <section className='mt-8 flex flex-col gap-2 sm:mt-10 sm:flex-row sm:flex-wrap sm:gap-3'>
        <Button
          asChild
          className='h-11 w-full rounded-full bg-neutral-950 text-white sm:h-10 sm:w-auto'
        >
          <Link href='/game'>Browse games</Link>
        </Button>
        <Button
          asChild
          variant='outline'
          className='h-11 w-full rounded-full sm:h-10 sm:w-auto'
        >
          <Link href='/'>Home</Link>
        </Button>
      </section>

      <ProfileActivity enabled={Boolean(user)} />

      <AvatarPickerModal
        open={avatarOpen}
        onOpenChange={setAvatarOpen}
        value={displayAvatar}
        onSelect={(next) => void onPickAvatar(next)}
      />
    </div>
  );
};

function BalanceCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className='min-w-0 rounded-2xl border border-neutral-200 bg-white px-3 py-3.5 sm:px-4 sm:py-4'>
      <p className='truncate text-[10px] font-medium uppercase tracking-wide text-neutral-400 sm:text-xs'>
        {label}
      </p>
      <div className='mt-2 min-w-0'>{children}</div>
    </div>
  );
}

/** Compact K/L/M for NIGHT strings that may include decimals. */
function formatCompactNight(raw: string) {
  if (raw === '—') return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return formatTokens(n);
}
