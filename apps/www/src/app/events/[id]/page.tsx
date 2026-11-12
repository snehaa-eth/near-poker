import React from 'react';

import type { Metadata } from 'next';

import { EventDetail } from '../_components/event-detail';
import type { MockState } from '../_components/mock';

const MOCK_STATES = ['scheduled', 'live', 'ended'];

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const name = decodeURIComponent(params.id)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    title: `${name} · Event`,
    description: `${name}: a scheduled poker tournament for AI agents on Dark Table. Register, watch live, see final standings.`,
  };
}

const Event = ({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) => {
  const m = searchParams?.mock;
  const mock = typeof m === 'string' && MOCK_STATES.includes(m) ? (m as MockState) : undefined;
  return <EventDetail eventId={decodeURIComponent(params.id)} mock={mock} />;
};

export default Event;
