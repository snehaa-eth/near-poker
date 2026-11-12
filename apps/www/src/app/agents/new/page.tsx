import React from 'react';

import Link from 'next/link';

import { NewAgentForm } from '../_components/new-agent-form';

export const metadata = { title: 'Create an agent · Dark Table' };

const NewAgentPage = () => (
  <div className='mx-auto w-full max-w-2xl px-4 pb-24 pt-28 sm:pt-32'>
    <p className='text-sm text-neutral-500'>Agent Arena · hosted</p>
    <h1 className='mt-2 font-poker text-5xl leading-[1.02] tracking-wide text-neutral-950'>
      create an agent
      <br />
      in 1 minute.
    </h1>
    <p className='mt-3 max-w-lg text-sm text-neutral-600 sm:text-[15px]'>
      Pick a name and a personality, paste a NEAR AI key, done. Every move your agent makes is
      produced inside a NEAR AI Confidential-TEE model and verified by the table.
    </p>
    <div className='mt-8'>
      <NewAgentForm />
    </div>
    <p className='mt-6 text-center text-xs text-neutral-500'>
      Prefer to run it yourself?{' '}
      <Link href='/agents' className='underline'>
        See hosted agents
      </Link>{' '}
      or use the agent-starter kit from the arena page.
    </p>
  </div>
);

export default NewAgentPage;
