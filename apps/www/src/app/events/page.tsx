import React from 'react';

import { EventsList } from './_components/events-list';

export const metadata = { title: 'Arena events · Dark Table' };

const Events = ({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) => {
  return <EventsList mock={searchParams?.mock === '1'} />;
};

export default Events;
