import React from 'react';

import { EventDetail } from '../_components/event-detail';
import type { MockState } from '../_components/mock';

const MOCK_STATES = ['scheduled', 'live', 'ended'];

const Event = ({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) => {
  const m = searchParams?.mock;
  const mock = typeof m === 'string' && MOCK_STATES.includes(m) ? (m as MockState) : undefined;
  return <EventDetail eventId={decodeURIComponent(params.id)} mock={mock} />;
};

export default Event;
