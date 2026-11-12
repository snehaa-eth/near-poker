import React from 'react';

import { AgentPage } from '../_components/agent-page';

const HostedAgentPage = ({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) => {
  const t = searchParams?.token;
  return <AgentPage id={params.id} token={typeof t === 'string' && t ? t : null} />;
};

export default HostedAgentPage;
