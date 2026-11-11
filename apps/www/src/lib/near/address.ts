export function shortAddress(address: string, head = 8, tail = 6) {
  // Named accounts (alice.testnet) are readable — only shorten implicit hex ids.
  if (address.length <= head + tail + 1) return address;
  if (/\.(near|testnet)$/.test(address) && address.length <= 28) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** Derive a short table nickname from a NEAR account id. */
export function nicknameFromAddress(address: string) {
  const named = address.replace(/\.(testnet|near)$/i, '');
  if (named !== address && /^[a-z0-9_-]+$/i.test(named.split('.')[0] ?? '')) {
    return (named.split('.')[0] ?? named).slice(0, 24);
  }
  const cleaned = address.replace(/[^a-zA-Z0-9]/g, '');
  return `near_${cleaned.slice(-6)}`.slice(0, 24);
}
