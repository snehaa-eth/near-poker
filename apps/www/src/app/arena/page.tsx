import React from 'react';

import { ArenaPage } from '~/components/arena/arena-page';

const Arena = ({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) => {
  return <ArenaPage mock={searchParams?.mock === '1'} />;
};

export default Arena;
