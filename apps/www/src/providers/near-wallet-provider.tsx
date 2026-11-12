'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  NEAR_NETWORK,
  NEAR_RPC,
  VAULT_ID,
  viewAccountBalance,
  viewFunction,
} from '~/lib/near/rpc';
import { formatNearFromYocto } from '~/lib/near/units';

import type { WalletSelector } from '@near-wallet-selector/core';
import type { WalletSelectorModal } from '@near-wallet-selector/modal-ui';
import '@near-wallet-selector/modal-ui/styles.css';
import { sha256 } from '@noble/hashes/sha256';
import { hexToBytes } from '@noble/hashes/utils';

export type NearNetworkId = 'testnet' | 'mainnet';

export type WalletBalances = {
  /** Liquid wallet balance, decimal NEAR string. */
  near: string;
  yocto: string;
  /** table-vault `balance_of` (decimal NEAR) when NEXT_PUBLIC_VAULT_ID is set. */
  vault: string | null;
  vaultYocto: string | null;
};

type WalletStatus = 'checking' | 'detected' | 'not-found';

/** NEP-413 signed login proof, forwarded to the server as `nearProof`. */
export type NearLoginProof = {
  accountId: string;
  publicKey: string;
  signature: string;
  message: string;
  recipient: string;
  /** base64 of the 32-byte NEP-413 nonce */
  nonce: string;
};

export type CallVaultInput = {
  methodName: string;
  args?: Record<string, unknown>;
  /** Attached deposit in yoctoNEAR. */
  depositYocto?: string;
};

export type CallVaultResult = { txHash: string | null };

type NearWalletContextValue = {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  ready: boolean;
  walletStatus: WalletStatus;
  walletName: string | null;
  networkId: NearNetworkId;
  selector: WalletSelector | null;
  balances: WalletBalances | null;
  balancesLoading: boolean;
  vaultId: string | null;
  connect: () => Promise<string | null>;
  disconnect: () => void;
  refreshBalances: () => Promise<WalletBalances | null>;
  signLoginMessage: (
    nonce?: string | Uint8Array
  ) => Promise<NearLoginProof | null>;
  callVault: (input: CallVaultInput) => Promise<CallVaultResult>;
};

const NearWalletContext = createContext<NearWalletContextValue | null>(null);

export const LOGIN_MESSAGE = 'Sign in to Dark Table';
export const LOGIN_RECIPIENT = 'dark-table';
const GAS_100_TGAS = '100000000000000';

/**
 * A real Buffer for wallet-selector's `Buffer.isBuffer` check. `Buffer` is not a browser global:
 * the bundler injects its polyfill into modules that name it, so name it here directly.
 */
function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes);
}

function nonceBytes(nonce?: string | Uint8Array): Uint8Array {
  if (nonce instanceof Uint8Array) {
    if (nonce.length !== 32) return sha256(nonce);
    return nonce;
  }
  if (typeof nonce === 'string') {
    if (/^[0-9a-f]{64}$/i.test(nonce)) return hexToBytes(nonce.toLowerCase());
    return sha256(new TextEncoder().encode(nonce));
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

function extractTxHash(outcome: unknown): string | null {
  if (!outcome || typeof outcome !== 'object') return null;
  const o = outcome as {
    transaction?: { hash?: string };
    transaction_outcome?: { id?: string };
  };
  return o.transaction?.hash ?? o.transaction_outcome?.id ?? null;
}

export function NearWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const modalRef = useRef<WalletSelectorModal | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletStatus, setWalletStatus] = useState<WalletStatus>('checking');
  const [walletName, setWalletName] = useState<string | null>(null);
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const pendingConnect = useRef<((id: string | null) => void) | null>(null);
  const coreRef = useRef<typeof import('@near-wallet-selector/core') | null>(
    null
  );

  // Init wallet-selector on the client only (modules touch `window`).
  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    void (async () => {
      try {
        // Meteor needs near-api-js@^6 (pinned in apps/www/package.json).
        const [core, { setupModal }, mnw, meteor] = await Promise.all([
          import('@near-wallet-selector/core'),
          import('@near-wallet-selector/modal-ui'),
          import('@near-wallet-selector/my-near-wallet'),
          import('@near-wallet-selector/meteor-wallet'),
        ]);
        const isMainnet = NEAR_NETWORK === 'mainnet';
        const sel = await core.setupWalletSelector({
          network: {
            networkId: NEAR_NETWORK,
            nodeUrl: NEAR_RPC,
            helperUrl: isMainnet
              ? 'https://helper.mainnet.near.org'
              : 'https://helper.testnet.near.org',
            explorerUrl: isMainnet
              ? 'https://nearblocks.io'
              : 'https://testnet.nearblocks.io',
            indexerUrl: isMainnet
              ? 'https://api.kitwallet.app'
              : 'https://testnet-api.kitwallet.app',
          },
          modules: [mnw.setupMyNearWallet(), meteor.setupMeteorWallet()],
        });
        if (cancelled) return;

        const modal = setupModal(sel, {
          theme: 'light',
          description: 'Connect a NEAR wallet to sit at Dark Table.',
        });
        modalRef.current = modal;

        const syncAccount = async () => {
          const state = sel.store.getState();
          const active =
            state.accounts.find((a) => a.active) ?? state.accounts[0];
          setAddress(active?.accountId ?? null);
          const mod = state.modules.find(
            (m) => m.id === state.selectedWalletId
          );
          setWalletName(mod?.metadata.name ?? null);
          return active?.accountId ?? null;
        };

        await syncAccount();
        const storeSub = sel.store.observable.subscribe(() => {
          void syncAccount();
        });
        cleanups.push(() => storeSub.unsubscribe());
        const signedInSub = sel.on('signedIn', (e) => {
          const id = e.accounts[0]?.accountId ?? null;
          setAddress(id);
          pendingConnect.current?.(id);
          pendingConnect.current = null;
        });
        cleanups.push(() => signedInSub.remove());
        const hideSub = modal.on('onHide', ({ hideReason }) => {
          if (hideReason === 'user-triggered') {
            pendingConnect.current?.(null);
            pendingConnect.current = null;
          }
        });
        cleanups.push(() => hideSub.remove());

        coreRef.current = core;
        setSelector(sel);
        setWalletStatus('detected');
      } catch (error) {
        console.warn('NEAR wallet selector init failed', error);
        setWalletStatus('not-found');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      for (const fn of cleanups) fn();
    };
  }, []);

  const connect = useCallback(async () => {
    if (address) return address;
    const modal = modalRef.current;
    if (!modal) throw new Error('NEAR wallet selector is still loading.');
    setIsConnecting(true);
    try {
      return await new Promise<string | null>((resolve) => {
        pendingConnect.current = resolve;
        modal.show();
      });
    } finally {
      setIsConnecting(false);
    }
  }, [address]);

  const disconnect = useCallback(() => {
    void (async () => {
      try {
        const wallet = await selector?.wallet();
        await wallet?.signOut();
      } catch (error) {
        console.warn('NEAR sign out failed', error);
      }
    })();
    setAddress(null);
    setBalances(null);
  }, [selector]);

  const refreshBalances = useCallback(async () => {
    if (!address) {
      setBalances(null);
      return null;
    }
    setBalancesLoading(true);
    try {
      const [yocto, vaultYocto] = await Promise.all([
        viewAccountBalance(address),
        VAULT_ID
          ? viewFunction<string>(VAULT_ID, 'balance_of', {
              account_id: address,
            }).catch(() => null)
          : Promise.resolve(null),
      ]);
      const next: WalletBalances = {
        yocto,
        near: formatNearFromYocto(yocto),
        vaultYocto,
        vault: vaultYocto != null ? formatNearFromYocto(vaultYocto) : null,
      };
      setBalances(next);
      return next;
    } catch (error) {
      console.warn('Failed to load NEAR balance', error);
      return null;
    } finally {
      setBalancesLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (!address) {
      setBalances(null);
      return;
    }
    void refreshBalances();
  }, [address, refreshBalances]);

  const signLoginMessage = useCallback(
    async (nonce?: string | Uint8Array): Promise<NearLoginProof | null> => {
      if (!selector || !address) return null;
      const wallet = await selector.wallet();
      if (typeof wallet.signMessage !== 'function') return null;
      const bytes = nonceBytes(nonce);
      const signed = await wallet.signMessage({
        message: LOGIN_MESSAGE,
        recipient: LOGIN_RECIPIENT,
        // wallet-selector checks Buffer.isBuffer(nonce): hand it a real Buffer (the bundler's
        // Buffer polyfill is the one the wallet code sees), not a plain Uint8Array.
        nonce: toBuffer(bytes),
      });
      if (!signed) return null;
      return {
        accountId: signed.accountId,
        publicKey: signed.publicKey,
        signature: signed.signature,
        message: LOGIN_MESSAGE,
        recipient: LOGIN_RECIPIENT,
        nonce: bytesToBase64(bytes),
      };
    },
    [selector, address]
  );

  const callVault = useCallback(
    async ({ methodName, args = {}, depositYocto = '0' }: CallVaultInput) => {
      if (!VAULT_ID) throw new Error('NEXT_PUBLIC_VAULT_ID is not configured.');
      const core = coreRef.current;
      if (!selector || !address || !core) {
        throw new Error('Connect a NEAR wallet first.');
      }
      const wallet = await selector.wallet();
      const outcome = await wallet.signAndSendTransaction({
        signerId: address,
        receiverId: VAULT_ID,
        actions: [
          core.actionCreators.functionCall(
            methodName,
            args,
            BigInt(GAS_100_TGAS),
            BigInt(depositYocto)
          ),
        ],
      });
      const result = { txHash: extractTxHash(outcome) };
      void refreshBalances();
      return result;
    },
    [selector, address, refreshBalances]
  );

  const value = useMemo<NearWalletContextValue>(
    () => ({
      address,
      isConnected: Boolean(address),
      isConnecting,
      ready,
      walletStatus,
      walletName,
      networkId: NEAR_NETWORK as NearNetworkId,
      selector,
      balances,
      balancesLoading,
      vaultId: VAULT_ID,
      connect,
      disconnect,
      refreshBalances,
      signLoginMessage,
      callVault,
    }),
    [
      address,
      isConnecting,
      ready,
      walletStatus,
      walletName,
      selector,
      balances,
      balancesLoading,
      connect,
      disconnect,
      refreshBalances,
      signLoginMessage,
      callVault,
    ]
  );

  return (
    <NearWalletContext.Provider value={value}>
      {children}
    </NearWalletContext.Provider>
  );
}

export function useNearWallet(): NearWalletContextValue {
  const ctx = useContext(NearWalletContext);
  if (!ctx) {
    throw new Error('useNearWallet must be used within NearWalletProvider');
  }
  return ctx;
}
