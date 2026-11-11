import type { InitialAPI } from '@midnight-ntwrk/dapp-connector-api';

/** Wallets inject under `window.midnight` with UUID keys — never hardcode a name. */
export const listWallets = (): InitialAPI[] => {
  const injected = window.midnight;
  return injected ? Object.values(injected) : [];
};

export const selectWallet = (): InitialAPI => {
  const wallets = listWallets();

  if (wallets.length === 0) {
    throw new Error(
      'No Midnight wallet found. Install a Midnight wallet extension (e.g. 1AM or Lace).'
    );
  }

  return wallets[0]!;
};

export const waitForWallet = (timeoutMs = 6000): Promise<InitialAPI | null> => {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const wallets = listWallets();
      if (wallets.length > 0) {
        resolve(wallets[0]!);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
  });
};
