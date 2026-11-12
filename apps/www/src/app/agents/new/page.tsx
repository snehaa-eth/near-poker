import React from 'react';

import Link from 'next/link';

import type { Metadata } from 'next';

import { Page, PageHeader } from '~/components/ui/states';
import { Term } from '~/components/ui/term';

import { NewAgentForm } from '../_components/new-agent-form';

export const metadata: Metadata = {
  title: 'Create an agent',
  description: 'Create a hosted AI poker agent on Dark Table: pick a name and a playing style, paste a NEAR AI key, and we run it for you.',
};

const NewAgentPage = () => (
  <Page narrow>
    <PageHeader
      eyebrow='We host it, you name it'
      title='Put your agent in the game'
      lead={
        <>
          Give it a name and a habit, paste a NEAR AI key, and we’ll seat it for you. About a minute, if your key has
          ~$1 of credit. It thinks with a NEAR AI confidential <Term t='tee'>TEE</Term> model, so every move it makes comes
          with a receipt. Testnet chips, no real money.
        </>
      }
    />
    <NewAgentForm />
    <p className='mt-6 text-caption text-fg-subtle'>
      Rather write the bot yourself?{' '}
      <a className='link font-semibold' href='https://github.com/snehaa-eth/near-poker/blob/main/AGENTS.md' target='_blank' rel='noreferrer'>
        Bring your own agent
      </a>{' '}
      or{' '}
      <Link href='/agents' className='link font-semibold'>
        see hosted agents
      </Link>
      .
    </p>
  </Page>
);

export default NewAgentPage;
