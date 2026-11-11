'use client';

import Link from 'next/link';

import React, { useCallback, useEffect, useState } from 'react';

import { Check, Copy, LogOut, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { ChipAmount } from '~/components/currency-amount';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { api, type LobbyGame, type PublicGameView } from '~/lib/api';
import { errorHandler } from '~/lib/utils';

function joinUrl(gameId: string) {
  if (typeof window === 'undefined') return `/game/${gameId}`;
  return `${window.location.origin}/game/${gameId}`;
}

async function copyText(label: string, value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error('Could not copy');
  }
}

export function AdminPage() {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [creating, setCreating] = useState(false);
  const [lobbies, setLobbies] = useState<LobbyGame[]>([]);
  const [loadingLobbies, setLoadingLobbies] = useState(false);
  const [lastCreated, setLastCreated] = useState<PublicGameView | null>(null);
  const [name, setName] = useState('');
  const [minChips, setMinChips] = useState('100');

  const refreshMe = useCallback(async () => {
    try {
      const me = await api.adminMe();
      setIsAdmin(me.admin);
      return me.admin;
    } catch {
      setIsAdmin(false);
      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  const loadLobbies = useCallback(async () => {
    setLoadingLobbies(true);
    try {
      const res = await api.listGames({ status: 'waiting' });
      setLobbies(res.games);
    } catch (error) {
      toast.error(errorHandler(error));
    } finally {
      setLoadingLobbies(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const ok = await refreshMe();
      if (ok) void loadLobbies();
    })();
  }, [refreshMe, loadLobbies]);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    try {
      await api.adminLogin(password);
      setPassword('');
      setIsAdmin(true);
      toast.success('Admin unlocked');
      await loadLobbies();
    } catch (error) {
      toast.error(errorHandler(error));
    } finally {
      setLoggingIn(false);
    }
  };

  const onLogout = async () => {
    try {
      await api.adminLogout();
      setIsAdmin(false);
      setLastCreated(null);
      toast.success('Admin locked');
    } catch (error) {
      toast.error(errorHandler(error));
    }
  };

  const onCreateLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    const chips = Math.floor(Number(minChips) || 0);
    if (name.trim().length < 2) {
      toast.error('Lobby name must be at least 2 characters.');
      return;
    }
    if (chips < 0) {
      toast.error('Min chips cannot be negative.');
      return;
    }
    setCreating(true);
    try {
      const game = await api.createGame({
        name: name.trim(),
        minChips: chips,
      });
      setLastCreated(game);
      setName('');
      toast.success('Lobby created', { description: game.joinCode });
      await loadLobbies();
    } catch (error) {
      toast.error(errorHandler(error));
    } finally {
      setCreating(false);
    }
  };

  if (checking) {
    return (
      <div className='mx-auto w-full max-w-6xl px-4 pb-16 pt-20 text-sm text-neutral-500 sm:px-6 sm:pt-24 lg:px-8'>
        Checking admin…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className='mx-auto flex w-full max-w-6xl flex-col px-4 pb-20 pt-20 sm:px-6 sm:pt-24 lg:px-8'>
        <p className='text-xs font-medium uppercase tracking-[0.18em] text-neutral-400 sm:text-sm'>
          Admin
        </p>
        <h1 className='mt-2 font-poker text-3xl tracking-wide text-neutral-950 sm:text-5xl'>
          Enter password
        </h1>
        <p className='mt-2 max-w-md text-sm text-neutral-600'>
          Only admins can create lobbies. Players join from Games.
        </p>

        <form
          onSubmit={onLogin}
          className='mt-8 w-full max-w-sm space-y-3 rounded-3xl border border-neutral-200 bg-white p-5'
        >
          <label className='block text-sm font-medium text-neutral-700'>
            Password
            <Input
              type='password'
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className='mt-1.5 h-11 rounded-full'
              placeholder='Admin password'
              autoComplete='current-password'
            />
          </label>
          <Button
            type='submit'
            disabled={loggingIn || !password}
            className='h-11 w-full rounded-full bg-neutral-950 text-white'
          >
            {loggingIn ? 'Checking…' : 'Unlock admin'}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className='mx-auto w-full max-w-6xl px-4 pb-20 pt-20 sm:px-6 sm:pt-24 lg:px-8'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <p className='text-xs font-medium uppercase tracking-[0.18em] text-neutral-400 sm:text-sm'>
            Admin
          </p>
          <h1 className='mt-2 font-poker text-3xl tracking-wide text-neutral-950 sm:text-5xl'>
            Lobbies
          </h1>
          <p className='mt-2 text-sm text-neutral-600'>
            Name the table, set a chip buy-in, then share the join code or URL.
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            size='sm'
            className='rounded-full'
            disabled={loadingLobbies}
            onClick={() => void loadLobbies()}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${loadingLobbies ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
          <Button
            variant='outline'
            size='sm'
            className='rounded-full'
            onClick={() => void onLogout()}
          >
            <LogOut className='mr-1.5 h-3.5 w-3.5' />
            Lock
          </Button>
        </div>
      </div>

      <form
        onSubmit={onCreateLobby}
        className='mt-8 space-y-4 rounded-3xl border border-neutral-200 bg-white p-5'
      >
        <div>
          <p className='text-sm font-semibold text-neutral-950'>
            Create lobby
          </p>
          <p className='mt-0.5 text-sm text-neutral-500'>
            Players need at least the min chips to sit down.
          </p>
        </div>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label htmlFor='lobby-name'>Lobby name</Label>
            <Input
              id='lobby-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              className='h-11 rounded-full'
              placeholder='Friday Night High'
              maxLength={48}
              required
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='lobby-min'>Min chips to join</Label>
            <Input
              id='lobby-min'
              type='number'
              min={0}
              step={1}
              inputMode='numeric'
              value={minChips}
              onChange={(e) => setMinChips(e.target.value)}
              className='h-11 rounded-full'
              placeholder='100'
              required
            />
          </div>
        </div>
        <Button
          type='submit'
          className='h-11 w-full rounded-full bg-neutral-950 text-white sm:w-auto'
          disabled={creating}
        >
          <Plus className='mr-1.5 h-4 w-4' />
          {creating ? 'Creating…' : 'Create lobby'}
        </Button>
      </form>

      {lastCreated ? (
        <CreatedLobbyCard game={lastCreated} />
      ) : null}

      <section className='mt-10'>
        <h2 className='text-lg font-semibold text-neutral-950'>
          Waiting lobbies
        </h2>
        {loadingLobbies && lobbies.length === 0 ? (
          <p className='mt-4 text-sm text-neutral-400'>Loading…</p>
        ) : lobbies.length === 0 ? (
          <p className='mt-4 text-sm text-neutral-400'>
            No waiting lobbies yet. Create one above.
          </p>
        ) : (
          <ul className='mt-4 divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white'>
            {lobbies.map((g) => {
              const url = joinUrl(g.gameId);
              return (
                <li
                  key={g.gameId}
                  className='flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between'
                >
                  <div className='min-w-0'>
                    <p className='truncate text-sm font-semibold text-neutral-900'>
                      {g.name || 'Table'}
                    </p>
                    <p className='mt-0.5 text-xs text-neutral-500'>
                      Code{' '}
                      <span className='font-mono font-medium text-neutral-800'>
                        {g.joinCode || '—'}
                      </span>
                      <span className='mx-1.5 text-neutral-300'>·</span>
                      Min <ChipAmount value={g.minChips ?? 0} size='sm' className='inline-flex text-xs' iconClassName='h-3.5 w-3.5' />
                      <span className='mx-1.5 text-neutral-300'>·</span>
                      {g.totalPlayers} player
                      {g.totalPlayers === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      className='rounded-full'
                      onClick={() =>
                        void copyText('Join code', g.joinCode || g.gameId)
                      }
                    >
                      <Copy className='mr-1.5 h-3.5 w-3.5' />
                      Code
                    </Button>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      className='rounded-full'
                      onClick={() => void copyText('Join URL', url)}
                    >
                      <Copy className='mr-1.5 h-3.5 w-3.5' />
                      URL
                    </Button>
                    <Button
                      asChild
                      variant='outline'
                      size='sm'
                      className='rounded-full'
                    >
                      <Link href={`/game/${g.gameId}`}>Open</Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function CreatedLobbyCard({ game }: { game: PublicGameView }) {
  const url = joinUrl(game.gameId);
  const [copied, setCopied] = useState<'code' | 'url' | null>(null);

  const onCopy = async (kind: 'code' | 'url') => {
    await copyText(
      kind === 'code' ? 'Join code' : 'Join URL',
      kind === 'code' ? game.joinCode : url
    );
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className='mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-950'>
      <p className='font-semibold'>{game.name} is live</p>
      <div className='mt-3 grid gap-2 sm:grid-cols-2'>
        <div className='rounded-xl bg-white/80 px-3 py-2'>
          <p className='text-[11px] uppercase tracking-wide text-emerald-700/80'>
            Join code
          </p>
          <div className='mt-1 flex items-center justify-between gap-2'>
            <span className='font-mono text-base font-semibold tracking-wider'>
              {game.joinCode}
            </span>
            <button
              type='button'
              onClick={() => void onCopy('code')}
              className='rounded-full p-1.5 text-emerald-800 hover:bg-emerald-100'
              aria-label='Copy join code'
            >
              {copied === 'code' ? (
                <Check className='h-4 w-4' />
              ) : (
                <Copy className='h-4 w-4' />
              )}
            </button>
          </div>
        </div>
        <div className='rounded-xl bg-white/80 px-3 py-2'>
          <p className='text-[11px] uppercase tracking-wide text-emerald-700/80'>
            Join URL
          </p>
          <div className='mt-1 flex items-center justify-between gap-2'>
            <span className='truncate font-mono text-xs'>{url}</span>
            <button
              type='button'
              onClick={() => void onCopy('url')}
              className='shrink-0 rounded-full p-1.5 text-emerald-800 hover:bg-emerald-100'
              aria-label='Copy join URL'
            >
              {copied === 'url' ? (
                <Check className='h-4 w-4' />
              ) : (
                <Copy className='h-4 w-4' />
              )}
            </button>
          </div>
        </div>
      </div>
      <p className='mt-3 flex flex-wrap items-center gap-2 text-xs text-emerald-800'>
        Min buy-in
        <ChipAmount
          value={game.minChips}
          size='sm'
          className='text-xs text-emerald-950'
          iconClassName='h-3.5 w-3.5'
        />
        <Link
          href={`/game/${game.gameId}`}
          className='ml-auto font-medium underline underline-offset-2'
        >
          Open table
        </Link>
      </p>
    </div>
  );
}
