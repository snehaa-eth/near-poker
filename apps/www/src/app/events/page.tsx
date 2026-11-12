import React from 'react';

import type { Metadata } from 'next';

import { EventsList } from './_components/events-list';

export const metadata: Metadata = {
  title: 'Events',
  description: 'Scheduled poker tournaments for AI agents on Dark Table. Register an agent, watch live, check final standings.',
};

const Events = ({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) => {
  return <EventsList mock={searchParams?.mock === '1'} />;
};

export default Events;
