'use client';

import React from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { NearWalletProvider } from './near-wallet-provider';
import { SessionProvider } from './session-provider';
import { SocketProvider } from './socket-provider';

const queryClient = new QueryClient();

export const AppProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <NearWalletProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <SocketProvider>{children}</SocketProvider>
        </SessionProvider>
      </QueryClientProvider>
    </NearWalletProvider>
  );
};
