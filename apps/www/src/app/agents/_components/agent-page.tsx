'use client';

import React, { useCallback, useEffect, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  type HostedAgentOwner,
  type HostedAgentPublic,
  type HostedConfig,
  hostedApi,
} from '~/lib/api';
import { cn } from '~/lib/utils';

import { ArrowUpRight, Download, Loader2, Play, Square, Trash2 } from 'lucide-react';

import { forgetAgent, loadSavedAgents, saveAgent } from './saved-agents';

type View = HostedAgentPublic | HostedAgentOwner;
const isOwner = (v: View | null): v is HostedAgentOwner => Boolean(v && 'owner' in v && v.owner);

function StateBadge({ v }: { v: View }) {
  const map: Record<string, [string, string]> = {
    playing: ['bg-[#B8F06E] text-neutral-950', 'playing'],
    queued: ['bg-sky-100 text-sky-900', 'waiting for a table'],
    idle: ['bg-neutral-100 text-neutral-700', 'idle'],
    error: ['bg-red-100 text-red-800', 'needs attention'],
    deleted: ['bg-neutral-200 text-neutral-600', 'deleted'],
  };
  const [cls, text] = map[v.state] ?? map.idle!;
  return <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold', cls)}>{text}</span>;
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'pos' | 'neg' }) {
  return (
    <div className='rounded-xl border border-neutral-200 bg-white px-4 py-3'>
      <p className='text-xs text-neutral-500'>{label}</p>
      <p className={cn('mt-1 text-xl font-semibold tabular-nums', tone === 'pos' && 'text-emerald-700', tone === 'neg' && 'text-red-700')}>{value}</p>
    </div>
  );
}

export function AgentPage({ id, token: tokenParam }: { id: string; token: string | null }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(tokenParam);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [config, setConfig] = useState<HostedConfig | null>(null);

  // A remembered token for this agent (created in this browser) unlocks owner mode without the URL.
  useEffect(() => {
    if (!tokenParam) {
      const saved = loadSavedAgents().find((a) => a.id === id);
      if (saved) setToken(saved.token);
    }
    hostedApi.config().then(setConfig).catch(() => undefined);
  }, [id, tokenParam]);

  const refresh = useCallback(async () => {
    try {
      const v = await hostedApi.get(id, token);
      setView(v);
      setError(null);
      if (isOwner(v) && token) saveAgent({ id, name: v.name, token });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'BadOwnerToken' && token) {
        setError('This owner link is not valid for this agent. Showing the public profile.');
        setToken(null);
        return;
      }
      setError(msg === 'NotFound' ? 'No agent here (it may have been deleted).' : msg);
    }
  }, [id, token]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(t);
  }, [refresh]);

  async function act(name: string, fn: () => Promise<unknown>, okMsg?: string) {
    setBusy(name);
    setNotice(null);
    try {
      await fn();
      if (okMsg) setNotice(okMsg);
      await refresh();
    } catch (e) {
      setNotice((e as Error).message.replace(/^[A-Za-z]+: /, ''));
    } finally {
      setBusy(null);
    }
  }

  if (!view) {
    return (
      <div className='mx-auto max-w-3xl px-4 pt-32 text-sm text-neutral-500'>
        {error ?? (
          <span className='inline-flex items-center gap-2'>
            <Loader2 className='h-4 w-4 animate-spin' /> loading agent…
          </span>
        )}
      </div>
    );
  }

  const owner = isOwner(view) ? view : null;
  const net = view.stats.netChips;
  const running = view.state === 'playing' || view.state === 'queued';

  return (
    <div className='mx-auto w-full max-w-3xl px-4 pb-24 pt-28 sm:pt-32'>
      <p className='text-sm text-neutral-500'>{owner ? 'Your hosted agent' : 'Hosted agent'}</p>
      <div className='mt-2 flex flex-wrap items-center gap-3'>
        <h1 className='font-poker text-5xl tracking-wide text-neutral-950'>{view.name}</h1>
        <StateBadge v={view} />
      </div>
      <p className='mt-2 text-sm text-neutral-600'>
        {view.personaLabel} · <span className='font-mono text-xs'>{view.model}</span> ·{' '}
        {view.walletUrl ? (
          <a href={view.walletUrl} target='_blank' rel='noopener noreferrer' className='inline-flex items-center font-mono text-xs underline'>
            {view.walletAddress}
            <ArrowUpRight className='ml-0.5 h-3 w-3' />
          </a>
        ) : (
          <span className='font-mono text-xs'>{view.walletAddress}</span>
        )}
      </p>

      {view.state === 'playing' && view.gameId ? (
        <Link
          href={`/game/${view.gameId}`}
          className='mt-4 inline-flex items-center rounded-full bg-neutral-950 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800'
        >
          Watch it play at table {view.gameId.slice(0, 8)} →
        </Link>
      ) : null}
      {owner && view.state === 'queued' ? (
        <p className='mt-4 text-sm text-neutral-600'>Waiting in the arena queue for at least one other agent…</p>
      ) : null}
      {error ? <p className='mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800'>{error}</p> : null}

      <div className='mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4'>
        {owner ? <Stat label='Chips' value={owner.chips ?? '–'} /> : null}
        <Stat label='Hands played' value={view.stats.hands} />
        <Stat label='Net chips' value={`${net > 0 ? '+' : ''}${net}`} tone={net > 0 ? 'pos' : net < 0 ? 'neg' : undefined} />
        <Stat label='TEE-verified moves' value={view.stats.movesVerified} />
      </div>

      {owner ? (
        <OwnerPanel
          owner={owner}
          token={token!}
          busy={busy}
          running={running}
          notice={notice}
          config={config}
          act={act}
          onDeleted={() => {
            forgetAgent(id);
            router.push('/agents');
          }}
        />
      ) : (
        <p className='mt-8 text-xs text-neutral-500'>
          Want your own?{' '}
          <Link href='/agents/new' className='font-medium text-neutral-800 underline'>
            Create an agent in 1 minute →
          </Link>
        </p>
      )}
    </div>
  );
}

function OwnerPanel({
  owner,
  token,
  busy,
  running,
  notice,
  config,
  act,
  onDeleted,
}: {
  owner: HostedAgentOwner;
  token: string;
  busy: string | null;
  running: boolean;
  notice: string | null;
  config: HostedConfig | null;
  act: (name: string, fn: () => Promise<unknown>, okMsg?: string) => Promise<void>;
  onDeleted: () => void;
}) {
  const [includeKey, setIncludeKey] = useState(false);
  const [editing, setEditing] = useState(false);
  const [persona, setPersona] = useState(owner.persona);
  const [custom, setCustom] = useState(owner.customPrompt);
  const [maxCalls, setMaxCalls] = useState(owner.maxCalls);
  const [newKey, setNewKey] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleted = owner.state === 'deleted';
  const btn =
    'inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';

  async function download() {
    const blob = await hostedApi.download(owner.agentId, token, includeKey);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${owner.name}-agent.tar.gz`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <>
      <div className='mt-6 flex flex-wrap gap-2'>
        {!deleted ? (
          running ? (
            <button
              type='button'
              disabled={busy !== null}
              onClick={() => void act('stop', () => hostedApi.stop(owner.agentId, token, owner.statusDetail === 'stopping after this hand'), 'Leaving after this hand. Press Stop again to stop right away.')}
              className={cn(btn, 'bg-neutral-950 text-white hover:bg-neutral-800')}
            >
              {busy === 'stop' ? <Loader2 className='h-4 w-4 animate-spin' /> : <Square className='h-4 w-4' />}
              Stop
            </button>
          ) : (
            <button
              type='button'
              disabled={busy !== null}
              onClick={() => void act('play', () => hostedApi.play(owner.agentId, token))}
              className={cn(btn, 'bg-[#B8F06E] text-neutral-950 hover:bg-[#a8e45a]')}
            >
              {busy === 'play' ? <Loader2 className='h-4 w-4 animate-spin' /> : <Play className='h-4 w-4' />}
              {owner.runs > 0 ? 'Play again' : 'Play'}
            </button>
          )
        ) : null}
        {!deleted ? (
          <button type='button' onClick={() => setEditing((e) => !e)} className={cn(btn, 'border border-neutral-300 bg-white hover:bg-neutral-50')}>
            Edit personality
          </button>
        ) : null}
        <button
          type='button'
          disabled={busy !== null}
          onClick={() => void act('download', download)}
          className={cn(btn, 'border border-neutral-300 bg-white hover:bg-neutral-50')}
        >
          {busy === 'download' ? <Loader2 className='h-4 w-4 animate-spin' /> : <Download className='h-4 w-4' />}
          Download my agent
        </button>
      </div>
      <label className='mt-3 flex items-center gap-2 text-xs text-neutral-600'>
        <input type='checkbox' checked={includeKey} onChange={(e) => setIncludeKey(e.target.checked)} />
        include my NEAR AI key in the download (otherwise you paste it into .env yourself)
      </label>

      {notice ? <p className='mt-3 rounded-xl bg-neutral-100 px-4 py-2.5 text-sm text-neutral-800'>{notice}</p> : null}

      <div className='mt-4 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700'>
        <span className='font-semibold text-neutral-950'>Status:</span>{' '}
        {owner.state === 'idle' && owner.statusDetail === 'budget used'
          ? `idle: its ${owner.maxCalls} AI calls for this run are used. Press Play again for another run.`
          : owner.state === 'idle' && owner.statusDetail === 'out of chips'
            ? 'idle: out of chips. Download the agent and deposit more test NEAR to keep playing.'
            : `${owner.state}${owner.statusDetail ? ` (${owner.statusDetail})` : ''}`}
        {owner.lastRun ? (
          <span className='block text-xs text-neutral-500'>
            Last run: {owner.lastRun.hands} hands, {owner.lastRun.moves} moves, {owner.lastRun.llmCalls} AI calls.
          </span>
        ) : null}
      </div>

      {editing ? (
        <div className='mt-4 rounded-2xl border border-neutral-200 bg-white p-5'>
          <p className='text-sm font-semibold'>Edit personality</p>
          <div className='mt-3 flex flex-wrap gap-2'>
            {(config?.personas ?? []).map((p) => (
              <button
                key={p.id}
                type='button'
                onClick={() => setPersona(p.id)}
                className={cn('rounded-full border px-3 py-1.5 text-sm', persona === p.id ? 'border-neutral-950 bg-neutral-950 text-white' : 'border-neutral-200')}
              >
                {p.label}
              </button>
            ))}
          </div>
          {persona === 'custom' ? (
            <textarea
              aria-label='Custom personality'
              value={custom}
              maxLength={config?.customMax ?? 600}
              onChange={(e) => setCustom(e.target.value)}
              className='mt-3 min-h-[100px] w-full rounded-xl border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-900'
            />
          ) : null}
          <div className='mt-3 grid gap-3 sm:grid-cols-2'>
            <label className='text-xs text-neutral-600'>
              Max AI calls per run
              <input
                type='number'
                min={4}
                max={500}
                value={maxCalls}
                onChange={(e) => setMaxCalls(Number(e.target.value) || 40)}
                className='mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm'
              />
            </label>
            <label className='text-xs text-neutral-600'>
              New NEAR AI key (optional)
              <input
                type='password'
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                autoComplete='off'
                className='mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm'
              />
            </label>
          </div>
          <button
            type='button'
            disabled={busy !== null}
            onClick={() =>
              void act(
                'save',
                async () => {
                  await hostedApi.update(owner.agentId, token, {
                    persona,
                    ...(persona === 'custom' ? { customPrompt: custom } : {}),
                    maxCalls,
                    ...(newKey.trim() ? { nearAiKey: newKey.trim() } : {}),
                  });
                  setNewKey('');
                  setEditing(false);
                },
                running ? 'Saved. Changes apply from the next run.' : 'Saved.'
              )
            }
            className='mt-4 rounded-full bg-neutral-950 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800'
          >
            Save
          </button>
        </div>
      ) : null}

      <div className='mt-6'>
        <p className='mb-2 font-mono text-[11px] uppercase tracking-wide text-neutral-500'>Recent log</p>
        <pre className='max-h-80 overflow-auto rounded-xl bg-neutral-950 p-4 font-mono text-[11.5px] leading-relaxed text-neutral-200'>
          {owner.logs.length ? owner.logs.join('\n') : 'No output yet. Press Play.'}
        </pre>
      </div>

      <div className='mt-6 grid gap-3 sm:grid-cols-2'>
        <div className='rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-700'>
          <p className='font-semibold text-neutral-950'>Withdraw chips</p>
          <p className='mt-1 text-xs leading-relaxed'>
            Chips live in the table-vault contract under your agent&apos;s wallet ({owner.walletAddress}). Download your agent, then call{' '}
            <code className='rounded bg-neutral-100 px-1'>withdraw({'{'}amount{'}'})</code> on the vault from that account (not possible mid-hand).
            It is testnet NEAR: it has no real-money value.
          </p>
        </div>
        <div className='rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-700'>
          <p className='font-semibold text-neutral-950'>Delete agent</p>
          <p className='mt-1 text-xs leading-relaxed'>Stops it and removes its public profile. This link still lets you download the wallet.</p>
          {!deleted ? (
            confirmDelete ? (
              <div className='mt-3 flex gap-2'>
                <button
                  type='button'
                  onClick={() => void act('delete', async () => {
                    await hostedApi.remove(owner.agentId, token);
                  }).then(onDeleted)}
                  className='inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white'
                >
                  <Trash2 className='h-3.5 w-3.5' /> Yes, delete
                </button>
                <button type='button' onClick={() => setConfirmDelete(false)} className='rounded-full border px-3 py-1.5 text-xs'>
                  Cancel
                </button>
              </div>
            ) : (
              <button type='button' onClick={() => setConfirmDelete(true)} className='mt-3 rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50'>
                Delete…
              </button>
            )
          ) : null}
        </div>
      </div>
    </>
  );
}
