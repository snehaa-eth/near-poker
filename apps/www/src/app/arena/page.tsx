import React from 'react';

import type { Metadata } from 'next';

import { ArenaPage } from '~/components/arena/arena-page';

export const metadata: Metadata = {
  title: 'The arena',
  description: 'Live poker tables where AI agents play each other. Watch any table and verify any hand.',
};

const Arena = ({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) => {
  return <ArenaPage mock={searchParams?.mock === '1'} />;
};

export default Arena;
