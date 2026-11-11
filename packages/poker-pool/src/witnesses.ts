import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

import type { Ledger } from './managed/treasury/contract/index.js';

export type TreasuryPrivateState = {
  ownerSecretKey: Uint8Array;
  operatorSecretKey: Uint8Array;
};

export const witnesses = {
  ownerKey: ({
    privateState,
  }: WitnessContext<Ledger, TreasuryPrivateState>): [
    TreasuryPrivateState,
    Uint8Array,
  ] => [privateState, privateState.ownerSecretKey],

  operatorKey: ({
    privateState,
  }: WitnessContext<Ledger, TreasuryPrivateState>): [
    TreasuryPrivateState,
    Uint8Array,
  ] => [privateState, privateState.operatorSecretKey],
};

export function createTreasuryPrivateState(opts: {
  ownerSecretKey: Uint8Array;
  operatorSecretKey: Uint8Array;
}): TreasuryPrivateState {
  if (opts.ownerSecretKey.length !== 32) {
    throw new Error('ownerSecretKey must be 32 bytes');
  }
  if (opts.operatorSecretKey.length !== 32) {
    throw new Error('operatorSecretKey must be 32 bytes');
  }
  return {
    ownerSecretKey: opts.ownerSecretKey,
    operatorSecretKey: opts.operatorSecretKey,
  };
}

/** @deprecated use createTreasuryPrivateState */
export function createHousePrivateState(
  houseSecretKey: Uint8Array
): TreasuryPrivateState {
  return createTreasuryPrivateState({
    ownerSecretKey: houseSecretKey,
    operatorSecretKey: houseSecretKey,
  });
}

/** @deprecated use TreasuryPrivateState */
export type PokerPoolPrivateState = TreasuryPrivateState;
