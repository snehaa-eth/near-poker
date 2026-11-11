import { env } from '~/env';

export const NEAR_RPC =
  env.NEXT_PUBLIC_NEAR_RPC ?? 'https://test.rpc.fastnear.com';
export const VAULT_ID = env.NEXT_PUBLIC_VAULT_ID ?? null;
export const NEAR_NETWORK = env.NEXT_PUBLIC_NEAR_NETWORK ?? 'testnet';

export function explorerTxUrl(tx: string) {
  return NEAR_NETWORK === 'mainnet'
    ? `https://nearblocks.io/txns/${tx}`
    : `https://testnet.nearblocks.io/txns/${tx}`;
}

async function rpcQuery<T>(params: Record<string, unknown>): Promise<T> {
  const res = await fetch(NEAR_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'dark-table',
      method: 'query',
      params: { finality: 'final', ...params },
    }),
  });
  const data = (await res.json()) as {
    result?: T & { error?: string };
    error?: { message?: string; cause?: { name?: string } };
  };
  if (data.error) {
    throw new Error(
      data.error.cause?.name ?? data.error.message ?? 'RPC error'
    );
  }
  if (!data.result) throw new Error('Empty RPC result');
  if (data.result.error) throw new Error(data.result.error);
  return data.result;
}

/** Liquid account balance in yoctoNEAR (0 for accounts that don't exist yet). */
export async function viewAccountBalance(accountId: string): Promise<string> {
  try {
    const result = await rpcQuery<{ amount: string }>({
      request_type: 'view_account',
      account_id: accountId,
    });
    return result.amount;
  } catch (error) {
    if (error instanceof Error && /UNKNOWN_ACCOUNT/.test(error.message)) {
      return '0';
    }
    throw error;
  }
}

function toBase64(s: string) {
  return btoa(unescape(encodeURIComponent(s)));
}

export async function viewFunction<T>(
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const result = await rpcQuery<{ result: number[] }>({
    request_type: 'call_function',
    account_id: contractId,
    method_name: methodName,
    args_base64: toBase64(JSON.stringify(args)),
  });
  const text = new TextDecoder().decode(new Uint8Array(result.result));
  return JSON.parse(text) as T;
}
