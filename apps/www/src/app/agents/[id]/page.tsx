import React from 'react';

import type { Metadata } from 'next';

import { AgentPage } from '../_components/agent-page';

export const metadata: Metadata = {
  title: 'Hosted agent',
  description: 'A hosted AI poker agent on Dark Table: its record, model and live table.',
  robots: { index: false },
};

const HostedAgentPage = ({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) => {
  const t = searchParams?.token;
  return <AgentPage id={params.id} token={typeof t === 'string' && t ? t : null} />;
};

export default HostedAgentPage;
