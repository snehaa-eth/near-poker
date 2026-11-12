'use client';

import Link from 'next/link';

import React, { useEffect, useState } from 'react';

import { type HostedAgentPublic, hostedApi } from '~/lib/api';
import { cn } from '~/lib/utils';

import { AgentAvatar } from '~/components/agent-avatar';
import { type Status, StatusPill } from '~/components/ui/badge';
import { buttonVariants } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { SkeletonRows } from '~/components/ui/skeleton';
import { EmptyState, ErrorState } from '~/components/ui/states';

import { ArrowRight, Bot } from 'lucide-react';

import { type SavedAgent, loadSavedAgents } from './saved-agents';

export const AGENT_STATE: Record<HostedAgentPublic['state'], { label: string; status: Status }> = {
  playing: { label: 'Playing', status: 'playing' },
  queued: { label: 'In queue', status: 'waiting' },
  idle: { label: 'Idle', status: 'finished' },
  error: { label: 'Stopped', status: 'offline' },
  deleted: { label: 'Deleted', status: 'offline' },
};

export function AgentsList() {
  const [agents, setAgents] = useState<HostedAgentPublic[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [mine, setMine] = useState<SavedAgent[]>([]);
  const load = () => {
    setFailed(false);
    setAgents(null);
    hostedApi
      .list()
      .then(setAgents)
      .catch(() => setFailed(true));
  };
  useEffect(() => {
    setMine(loadSavedAgents());
    load();
  }, []);
  return (
    <div className='flex flex-col gap-12'>
      {mine.length ? (
        <section aria-labelledby='mine-h'>
          <h2 id='mine-h' className='text-h3 font-semibold'>
            Your agents
          </h2>
          <p className='mt-1 text-caption text-fg-subtle'>Created in this browser. Manage links stay on this device.</p>
          <ul className='mt-4 flex flex-wrap gap-2'>
            {mine.map((a) => (
              <li key={a.id}>
                <Link href={`/agents/${a.id}?token=${encodeURIComponent(a.token)}`} className={buttonVariants({ variant: 'secondary' })}>
                  <AgentAvatar name={a.name} size={24} />
                  {a.name}
                  <span className='text-fg-subtle'>· Manage</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby='all-h'>
        <h2 id='all-h' className='text-h3 font-semibold'>
          All hosted agents
        </h2>
        <div className='mt-4'>
          {failed ? (
            <ErrorState onRetry={load} />
          ) : agents === null ? (
            <Card className='p-0 sm:p-0'>
              <SkeletonRows rows={3} />
            </Card>
          ) : agents.length === 0 ? (
            <EmptyState
              icon={<Bot />}
              title='No hosted agents yet'
              actions={
                <Link href='/agents/new' className={buttonVariants({ variant: 'primary' })}>
                  Create the first one
                </Link>
              }
            >
              A hosted agent is an AI poker player we run for you on our server. You choose the name and playing style.
            </EmptyState>
          ) : (
            <Card className='overflow-hidden p-0 sm:p-0'>
              <ul className='divide-y divide-border'>
                {agents.map((a) => {
                  const st = AGENT_STATE[a.state] ?? AGENT_STATE.idle;
                  return (
                    <li key={a.agentId}>
                      <Link href={`/agents/${a.agentId}`} className='flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 sm:px-6'>
                        <AgentAvatar name={a.name} size={36} />
                        <div className='min-w-0 flex-1'>
                          <p className='truncate font-semibold'>{a.name}</p>
                          <p className='mt-0.5 flex flex-wrap items-center gap-2 text-caption text-fg-subtle'>
                            <StatusPill status={st.status}>{st.label}</StatusPill>
                            {a.personaLabel}
                          </p>
                        </div>
                        <div className='text-right text-caption tabular-nums'>
                          <p className={cn('font-semibold', a.stats.netChips > 0 ? 'text-positive' : a.stats.netChips < 0 ? 'text-negative' : 'text-fg-muted')}>
                            {a.stats.netChips > 0 ? '+' : a.stats.netChips < 0 ? '−' : ''}
                            {Math.abs(a.stats.netChips)} chips
                          </p>
                          <p className='text-fg-subtle'>{a.stats.hands} hands</p>
                        </div>
                        <ArrowRight className='hidden size-4 text-fg-subtle sm:block' aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
