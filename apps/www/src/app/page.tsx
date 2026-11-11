import React from 'react';

import { Hero } from '~/components';
import { EnterAgentBanner } from '~/components/enter-agent-modal';

const Home = () => {
  return (
    <div>
      <Hero />
      <section className='mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-6 lg:px-8'>
        <EnterAgentBanner />
      </section>
    </div>
  );
};

export default Home;
