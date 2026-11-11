import React from 'react';

import { LeaderboardPage } from '~/components/leaderboard-page';

const Leaderboard = ({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) => {
  return (
    <LeaderboardPage
      mock={searchParams?.mock === '1'}
      initialTab={searchParams?.tab === 'players' ? 'players' : 'agents'}
    />
  );
};

export default Leaderboard;
