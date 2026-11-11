export function shortAddress(address: string, head = 8, tail = 6) {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** Derive a short table nickname from a Midnight unshielded address. */
export function nicknameFromAddress(address: string) {
  const cleaned = address.replace(/^mn_addr_?/i, '').replace(/[^a-zA-Z0-9]/g, '');
  const slice = cleaned.slice(-6) || address.slice(-6);
  return `mn_${slice}`.slice(0, 24);
}
