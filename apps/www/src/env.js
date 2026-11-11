import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']),
  },
  client: {
    NEXT_PUBLIC_API_URL: z.string().url(),
    NEXT_PUBLIC_WS_URL: z.string().url(),
    NEXT_PUBLIC_NEAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
    NEXT_PUBLIC_NEAR_RPC: z
      .string()
      .url()
      .default('https://test.rpc.fastnear.com'),
    /** table-vault contract account. When unset, deposits/withdrawals stay off-chain. */
    NEXT_PUBLIC_VAULT_ID: z.string().optional(),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
    NEXT_PUBLIC_NEAR_NETWORK: process.env.NEXT_PUBLIC_NEAR_NETWORK,
    NEXT_PUBLIC_NEAR_RPC: process.env.NEXT_PUBLIC_NEAR_RPC,
    NEXT_PUBLIC_VAULT_ID: process.env.NEXT_PUBLIC_VAULT_ID,
  },
  skipValidation: Boolean(process.env.SKIP_ENV_VALIDATION),
  emptyStringAsUndefined: true,
});
