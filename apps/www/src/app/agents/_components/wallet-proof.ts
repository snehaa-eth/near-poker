'use client';

import { useCallback } from 'react';

import { type NearLoginProof, useNearWallet } from '~/providers/near-wallet-provider';
import { api } from '~/lib/api';

/**
 * Optional wallet proof for "my agents": connect (if needed), fetch a server nonce, sign it.
 * Same NEP-413 message as sign-in. No session is created; the proof is used once.
 */
export function useWalletProof() {
  const wallet = useNearWallet();
  const prove = useCallback(async (): Promise<NearLoginProof> => {
    let address = wallet.address;
    if (!address) {
      address = await wallet.connect();
      if (!address) throw new Error('Connect a NEAR wallet to continue.');
    }
    const n = await api.loginNonce();
    const nonce = Uint8Array.from(atob(n.nonce), (c) => c.charCodeAt(0));
    const proof = await wallet.signLoginMessage(nonce);
    if (!proof) throw new Error('Your wallet did not sign the message. Try again, or use Meteor Wallet.');
    return proof;
  }, [wallet]);
  return { prove, address: wallet.address };
}
