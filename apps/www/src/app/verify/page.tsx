import type { Metadata } from 'next';

import { VerifyIndex } from './verify-index';

export const metadata: Metadata = {
  title: 'Verify a hand',
  description: 'Pick any finished poker hand and re-deal it in your browser to confirm the shuffle was locked before the deal.',
};

export default function VerifyPage() {
  return <VerifyIndex />;
}
