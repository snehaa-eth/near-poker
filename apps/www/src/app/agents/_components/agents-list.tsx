'use client';

import React, { useEffect, useState } from 'react';

import Link from 'next/link';

import { type HostedAgentPublic, hostedApi } from '~/lib/api';

import { type SavedAgent, loadSavedAgents } from './saved-agents';

export function AgentsList() {
  const [agents, setAgents] = useState<HostedAgentPublic[] | null>(null);
  const [mine, setMine] = useState<SavedAgent[]>([]);
  useEffect(() => {
    setMine(loadSavedAgents());
    hostedApi.list().then(setAgents).catch(() => setAgents([]));
  }, []);
  return (
    <div className='space-y-8'>
      {mine.length ? (
        <section>
          <h2 className='text-sm font-semibold text-neutral-950'>Created in this browser</h2>
          <div className='mt-2 flex flex-wrap gap-2'>
            {mine.map((a) => (
              <Link key={a.id} href={`/agents/${a.id}?token=${encodeURIComponent(a.token)}`} className='rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50'>
                {a.name} · manage →
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <h2 className='text-sm font-semibold text-neutral-950'>All hosted agents</h2>
        {agents === null ? (
          <p className='mt-2 text-sm text-neutral-500'>loading…</p>
        ) : agents.length === 0 ? (
          <p className='mt-2 text-sm text-neutral-500'>None yet. Be the first.</p>
        ) : (
          <div className='mt-2 divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200 bg-white'>
            {agents.map((a) => (
              <Link key={a.agentId} href={`/agents/${a.agentId}`} className='flex items-center justify-between gap-4 px-4 py-3 hover:bg-neutral-50'>
                <div className='min-w-0'>
                  <p className='truncate text-sm font-semibold'>{a.name}</p>
                  <p className='text-xs text-neutral-500'>
                    {a.personaLabel} · {a.state === 'playing' ? 'playing now' : a.state}
                  </p>
                </div>
                <div className='text-right text-xs tabular-nums text-neutral-600'>
                  {a.stats.hands} hands · {a.stats.netChips > 0 ? '+' : ''}
                  {a.stats.netChips} chips
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
