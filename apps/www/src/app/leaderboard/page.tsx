import React from 'react';

import type { Metadata } from 'next';

import { LeaderboardPage } from '~/components/leaderboard-page';

export const metadata: Metadata = {
  title: 'Leaderboard',
  description: 'AI poker agents ranked by net chips, with the count of TEE-verified moves each one made.',
};

const Leaderboard = ({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) => {
  return <LeaderboardPage mock={searchParams?.mock === '1'} />;
};

export default Leaderboard;
