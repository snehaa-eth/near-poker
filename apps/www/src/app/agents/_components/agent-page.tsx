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

import { AgentAvatar } from '~/components/agent-avatar';
import { StatusPill } from '~/components/ui/badge';
import { Button, buttonVariants } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { inputClass } from '~/components/ui/input';
import { Skeleton } from '~/components/ui/skeleton';
import { EmptyState, ErrorState, Page } from '~/components/ui/states';

import { ArrowLeft, ArrowRight, ArrowUpRight, Bot, Download, Loader2, Play, Square, Trash2 } from 'lucide-react';

import { AGENT_STATE } from './agents-list';

import { forgetAgent, loadSavedAgents, saveAgent } from './saved-agents';

type View = HostedAgentPublic | HostedAgentOwner;
const isOwner = (v: View | null): v is HostedAgentOwner => Boolean(v && 'owner' in v && v.owner);

function StateBadge({ v }: { v: View }) {
  const st = AGENT_STATE[v.state] ?? AGENT_STATE.idle;
  const label = v.state === 'queued' ? 'Waiting for a table' : v.state === 'error' ? 'Needs attention' : st.label;
  return <StatusPill status={st.status}>{label}</StatusPill>;
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'pos' | 'neg' }) {
  return (
    <div className='rounded-md border border-border bg-surface px-4 py-3'>
      <p className='eyebrow'>{label}</p>
      <p className={cn('mt-1 text-h3 font-semibold tabular-nums', tone === 'pos' && 'text-positive', tone === 'neg' && 'text-negative')}>{value}</p>
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
        setNotice('This manage link isn’t valid for this agent, so you’re seeing the public profile.');
        setToken(null);
        return;
      }
      setError(msg === 'NotFound' ? 'NotFound' : 'Offline');
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
    if (error === 'NotFound') {
      return (
        <Page narrow>
          <h1 className='font-display text-h1-sm uppercase sm:text-h1'>Agent not found</h1>
          <EmptyState
            className='mt-6'
            icon={<Bot />}
            title='There’s no agent at this link'
            actions={
              <>
                <Link href='/agents' className={buttonVariants({ variant: 'secondary' })}>
                  All agents
                </Link>
                <Link href='/agents/new' className={buttonVariants({ variant: 'primary' })}>
                  Create one
                </Link>
              </>
            }
          >
            It may have been deleted, or the link is mistyped.
          </EmptyState>
        </Page>
      );
    }
    return (
      <Page narrow>
        <h1 className='sr-only'>Hosted agent</h1>
        {error ? <ErrorState onRetry={() => void refresh()} /> : <Skeleton className='h-64 rounded-md' />}
      </Page>
    );
  }

  const owner = isOwner(view) ? view : null;
  const net = view.stats.netChips;
  const running = view.state === 'playing' || view.state === 'queued';

  return (
    <Page narrow>
      <Link href='/agents' className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-3 mb-4')}>
        <ArrowLeft aria-hidden /> All agents
      </Link>
      <p className='eyebrow'>{owner ? 'Your hosted agent' : 'Hosted agent'}</p>
      <div className='mt-3 flex flex-wrap items-center gap-4'>
        <AgentAvatar name={view.name} size={56} active={view.state === 'playing'} />
        <h1 className='min-w-0 break-words text-h1-sm font-semibold sm:text-h1'>{view.name}</h1>
        <StateBadge v={view} />
      </div>
      <p className='mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-muted'>
        <span>{view.personaLabel}</span>
        <span aria-hidden>·</span>
        <span className='font-mono text-[12px]'>{view.model}</span>
        <span aria-hidden>·</span>
        {view.walletUrl ? (
          <a href={view.walletUrl} target='_blank' rel='noopener noreferrer' className='inline-flex min-w-0 items-center gap-1 break-all font-mono text-[12px] text-fg-muted hover:text-accent'>
            {view.walletAddress}
            <ArrowUpRight className='size-3 shrink-0' aria-hidden />
          </a>
        ) : (
          <span className='break-all font-mono text-[12px]'>{view.walletAddress}</span>
        )}
      </p>

      {view.state === 'playing' && view.gameId ? (
        <Link href={`/game/${view.gameId}`} className={cn(buttonVariants({ variant: 'primary', size: 'lg' }), 'mt-6')}>
          Watch it play <ArrowRight aria-hidden />
        </Link>
      ) : null}
      {owner && view.state === 'queued' ? (
        <p className='mt-4 text-caption text-fg-muted'>In the arena queue, waiting for at least one other agent…</p>
      ) : null}

      <div className='mt-8 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4'>
        {owner ? <Stat label='Chips' value={owner.chips ?? '—'} /> : null}
        <Stat label='Hands' value={view.stats.hands} />
        <Stat label='Net chips' value={`${net > 0 ? '+' : net < 0 ? '−' : ''}${Math.abs(net)}`} tone={net > 0 ? 'pos' : net < 0 ? 'neg' : undefined} />
        <Stat label='Verified moves' value={view.stats.movesVerified} />
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
        <>
          {notice ? <p className='mt-6 rounded-sm border border-warning/40 bg-warning/10 px-4 py-3 text-caption'>{notice}</p> : null}
          <p className='mt-8 text-caption text-fg-subtle'>
            Want your own?{' '}
            <Link href='/agents/new' className='link font-semibold'>
              Create an agent
            </Link>
          </p>
        </>
      )}
    </Page>
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
      <div className='mt-8 flex flex-wrap gap-2'>
        {!deleted ? (
          running ? (
            <Button
              variant='secondary'
              disabled={busy !== null}
              onClick={() => void act('stop', () => hostedApi.stop(owner.agentId, token, owner.statusDetail === 'stopping after this hand'), 'Leaving after this hand. Press Stop again to stop right away.')}
            >
              {busy === 'stop' ? <Loader2 className='animate-spin' aria-hidden /> : <Square aria-hidden />}
              Stop
            </Button>
          ) : (
            <Button disabled={busy !== null} onClick={() => void act('play', () => hostedApi.play(owner.agentId, token))}>
              {busy === 'play' ? <Loader2 className='animate-spin' aria-hidden /> : <Play aria-hidden />}
              {owner.runs > 0 ? 'Play again' : 'Play'}
            </Button>
          )
        ) : null}
        {!deleted ? (
          <Button variant='secondary' onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
            Edit playing style
          </Button>
        ) : null}
        <Button variant='secondary' disabled={busy !== null} onClick={() => void act('download', download)}>
          {busy === 'download' ? <Loader2 className='animate-spin' aria-hidden /> : <Download aria-hidden />}
          Download my agent
        </Button>
      </div>
      <label className='mt-3 flex min-h-11 items-center gap-3 text-caption text-fg-muted sm:min-h-0'>
        <input type='checkbox' className='size-4 accent-[var(--accent)]' checked={includeKey} onChange={(e) => setIncludeKey(e.target.checked)} />
        Include my NEAR AI key in the download (otherwise paste it into .env yourself)
      </label>

      {notice ? (
        <p role='status' className='mt-4 rounded-sm border border-border bg-surface-2 px-4 py-3 text-caption'>
          {notice}
        </p>
      ) : null}

      <Card className='mt-6 p-4 sm:p-4'>
        <p className='text-caption text-fg-muted'>
          <span className='font-semibold text-fg'>Status: </span>
          {owner.state === 'idle' && owner.statusDetail === 'budget used'
            ? `Idle. Its ${owner.maxCalls} AI calls for this run are used. Press Play again for another run.`
            : owner.state === 'idle' && owner.statusDetail === 'out of chips'
              ? 'Idle. Out of chips. Download the agent and deposit more test NEAR to keep playing.'
              : `${owner.state}${owner.statusDetail ? ` (${owner.statusDetail})` : ''}`}
        </p>
        {owner.lastRun ? (
          <p className='mt-1 text-caption text-fg-subtle'>
            Last run: {owner.lastRun.hands} hands, {owner.lastRun.moves} moves, {owner.lastRun.llmCalls} AI calls.
          </p>
        ) : null}
      </Card>

      {editing ? (
        <Card className='mt-4'>
          <p className='font-semibold'>Edit playing style</p>
          <div className='mt-3 flex flex-wrap gap-2' role='radiogroup' aria-label='Playing style'>
            {(config?.personas ?? []).map((p) => (
              <Button
                key={p.id}
                role='radio'
                aria-checked={persona === p.id}
                variant='secondary'
                size='sm'
                onClick={() => setPersona(p.id)}
                className={cn(persona === p.id && 'border-accent bg-accent-soft text-fg')}
              >
                {p.label}
              </Button>
            ))}
          </div>
          {persona === 'custom' ? (
            <textarea
              aria-label='Custom playing style'
              value={custom}
              maxLength={config?.customMax ?? 600}
              onChange={(e) => setCustom(e.target.value)}
              className={cn(inputClass, 'mt-3 h-auto min-h-[100px] py-2')}
            />
          ) : null}
          <div className='mt-4 grid gap-4 sm:grid-cols-2'>
            <label className='flex flex-col gap-2 text-caption font-semibold'>
              Max AI calls per run
              <input type='number' min={4} max={500} value={maxCalls} onChange={(e) => setMaxCalls(Number(e.target.value) || 40)} className={cn(inputClass, 'tabular-nums')} />
            </label>
            <label className='flex flex-col gap-2 text-caption font-semibold'>
              New NEAR AI key (optional)
              <input type='password' value={newKey} onChange={(e) => setNewKey(e.target.value)} autoComplete='off' className={inputClass} />
            </label>
          </div>
          <Button
            className='mt-4'
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
          >
            Save
          </Button>
        </Card>
      ) : null}

      <section className='mt-8' aria-labelledby='log-h'>
        <h2 id='log-h' className='eyebrow mb-2'>
          Recent log
        </h2>
        <pre tabIndex={0} className='max-h-80 overflow-auto rounded-sm border border-border bg-bg p-4 font-mono text-[12px] leading-5 text-fg-muted'>
          {owner.logs.length ? owner.logs.join('\n') : 'No output yet. Press Play.'}
        </pre>
      </section>

      <div className='mt-8 grid gap-4 sm:grid-cols-2'>
        <Card className='p-4 sm:p-4'>
          <p className='font-semibold'>Withdraw chips</p>
          <p className='mt-1 text-caption text-fg-muted'>
            Chips live in the table-vault contract under your agent’s wallet ({owner.walletAddress}). Download your agent,
            then call <code className='rounded-xs bg-surface-3 px-1 font-mono text-[12px]'>withdraw({'{'}amount{'}'})</code> on the vault from that
            account (not mid-hand). It’s testnet NEAR with no real-money value.
          </p>
        </Card>
        <Card className='p-4 sm:p-4'>
          <p className='font-semibold'>Delete agent</p>
          <p className='mt-1 text-caption text-fg-muted'>Stops it and removes its public profile. This link still lets you download the wallet.</p>
          {!deleted ? (
            confirmDelete ? (
              <div className='mt-3 flex gap-2'>
                <Button
                  variant='danger'
                  size='sm'
                  onClick={() =>
                    void act('delete', async () => {
                      await hostedApi.remove(owner.agentId, token);
                    }).then(onDeleted)
                  }
                >
                  <Trash2 aria-hidden /> Yes, delete
                </Button>
                <Button variant='ghost' size='sm' onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant='danger' size='sm' className='mt-3' onClick={() => setConfirmDelete(true)}>
                Delete…
              </Button>
            )
          ) : null}
        </Card>
      </div>
    </>
  );
}
