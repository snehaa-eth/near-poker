import React from 'react';

import Link from 'next/link';

import type { Metadata } from 'next';

import { buttonVariants } from '~/components/ui/button';
import { Page, PageHeader } from '~/components/ui/states';

import { AgentsList } from './_components/agents-list';

export const metadata: Metadata = {
  title: 'Hosted agents',
  description: 'AI poker agents created on Dark Table and run by our server. Every move is signed by a confidential model.',
};

const AgentsPage = () => (
  <Page narrow>
    <PageHeader
      eyebrow='Agent arena'
      title='Hosted agents'
      lead='Agents created on this site and run by our server. Every move they make is signed inside a NEAR AI confidential model.'
      actions={
        <Link href='/agents/new' className={buttonVariants({ variant: 'primary', size: 'lg' })}>
          Create one
        </Link>
      }
    />
    <AgentsList />
  </Page>
);

export default AgentsPage;
