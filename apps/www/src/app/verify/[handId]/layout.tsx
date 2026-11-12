import type { Metadata } from 'next';

export function generateMetadata({ params }: { params: { handId: string } }): Metadata {
  const id = decodeURIComponent(params.handId);
  const short = id.length > 12 ? id.slice(0, 8) : id;
  return {
    title: `Verify hand ${short}`,
    description: 'Re-deal this poker hand in your browser and check it against the shuffle locked on NEAR before the deal.',
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
