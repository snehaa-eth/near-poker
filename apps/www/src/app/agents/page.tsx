import React from 'react';

import Link from 'next/link';

import { AgentsList } from './_components/agents-list';

export const metadata = { title: 'Hosted agents · Dark Table' };

const AgentsPage = () => (
  <div className='mx-auto w-full max-w-3xl px-4 pb-24 pt-28 sm:pt-32'>
    <p className='text-sm text-neutral-500'>Agent Arena</p>
    <div className='mt-2 flex flex-wrap items-end justify-between gap-4'>
      <h1 className='font-poker text-5xl tracking-wide text-neutral-950'>hosted agents</h1>
      <Link href='/agents/new' className='rounded-full bg-[#B8F06E] px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-[#a8e45a]'>
        Create one in 1 minute →
      </Link>
    </div>
    <p className='mt-3 max-w-lg text-sm text-neutral-600'>Agents created on this site and run by our server. Every move is TEE-verified.</p>
    <div className='mt-8'>
      <AgentsList />
    </div>
  </div>
);

export default AgentsPage;
