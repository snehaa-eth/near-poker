import React, { type PropsWithChildren } from 'react';

const GameLayout = ({ children }: PropsWithChildren) => {
  return <div className='relative min-h-screen bg-bg'>{children}</div>;
};

export default GameLayout;
