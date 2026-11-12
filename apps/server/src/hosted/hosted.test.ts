/** Hosted agents: unit tests (crypto, owner token, rate limit, redaction, bundle, near-mode wallet with a stubbed chain). */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { getHostedConfig } from './config.js';
import { checkOwnerToken, decryptSecret, encryptSecret, newOwnerToken, secretKey, sha256Hex } from './crypto.js';
import { buildAgentBundle, prefillStrategy } from './download.js';
import { personaText } from './personas.js';
import { RateLimiter } from './rate-limit.js';
import { redact } from './runner.js';
import { clientIp, validateName } from './routes.js';
import { WalletError, createWallet, setChainOps, type ChainOps } from './wallet.js';
import type { HostedAgentDoc } from '../db.js';

const KEY = Buffer.alloc(32, 7);

describe('secrets at rest (AES-256-GCM)', () => {
  it('round-trips, uses a fresh IV, and rejects tampering or a wrong key', () => {
    const a = encryptSecret('sk-very-secret-123', KEY);
    const b = encryptSecret('sk-very-secret-123', KEY);
    assert.notEqual(a, b);
    assert.ok(!a.includes('very-secret'));
    assert.equal(decryptSecret(a, KEY), 'sk-very-secret-123');
    const parts = a.split(':');
    const ct = Buffer.from(parts[3]!, 'base64url');
    ct[0] ^= 1;
    parts[3] = ct.toString('base64url');
    assert.throws(() => decryptSecret(parts.join(':'), KEY));
    assert.throws(() => decryptSecret(a, Buffer.alloc(32, 8)));
  });

  it('HOSTED_SECRET: validated hex; required in near mode; dev fallback otherwise', () => {
    assert.deepEqual(secretKey({ HOSTED_SECRET: 'ab'.repeat(32) }), Buffer.alloc(32, 0xab));
    assert.throws(() => secretKey({ HOSTED_SECRET: 'nothex' }), /32 bytes/);
    assert.throws(() => secretKey({ CHAIN: 'near' }), /required/);
    assert.equal(secretKey({}).length, 32);
  });
});

describe('owner token', () => {
  it('only the exact token matches the stored sha256', () => {
    const { token, hash } = newOwnerToken();
    assert.equal(hash, sha256Hex(token));
    assert.ok(checkOwnerToken(token, hash));
    assert.ok(!checkOwnerToken(`${token}x`, hash));
    assert.ok(!checkOwnerToken(token.slice(0, -1), hash));
    assert.ok(!checkOwnerToken(hash, hash));
    assert.ok(!checkOwnerToken(undefined, hash));
    assert.ok(!checkOwnerToken(['x'], hash));
  });
});

describe('rate limit + names', () => {
  it('allows N per window per key', () => {
    let t = 0;
    const rl = new RateLimiter(() => 3, 1000, () => t);
    assert.ok(rl.take('a') && rl.take('a') && rl.take('a'));
    assert.ok(!rl.take('a'));
    assert.ok(rl.take('b'));
    t = 1001;
    assert.ok(rl.take('a'));
  });

  it('client IP: last X-Forwarded-For hop, else req.ip', () => {
    const req = (xff?: string) => ({ ip: '10.0.0.1', get: (h: string) => (h === 'x-forwarded-for' ? xff : undefined) }) as never;
    assert.equal(clientIp(req('1.1.1.1, 2.2.2.2')), '2.2.2.2');
    assert.equal(clientIp(req()), '10.0.0.1');
  });

  it('agent names: 3–20 of [a-z0-9-]', () => {
    assert.equal(validateName('my-bot1'), 'my-bot1');
    assert.equal(validateName('My-Bot'), 'my-bot');
    for (const bad of ['ab', 'a'.repeat(21), 'has space', 'dot.ted', '-lead', 'trail-', 'dou--ble', 'émoji', '']) {
      assert.equal(validateName(bad), null, bad);
    }
  });
});

describe('log redaction', () => {
  it('removes the agent secrets and anything key-shaped', () => {
    const line = redact('key ed25519:3D4YudUahN1HMqD9ADgWq6M4vHwJYAPRBMTcvq4Lf8u1gN6S9GjRGhLHvt9yGvbJk2kfRDCRFxL3vG4h7G7b7HtM and sk-abcdef123456 and mysecretvalue', [
      'mysecretvalue',
    ]);
    assert.ok(!line.includes('3D4YudUa'));
    assert.ok(!line.includes('sk-abcdef'));
    assert.ok(!line.includes('mysecretvalue'));
  });
});

describe('download bundle', () => {
  const agentDir = getHostedConfig().agentDir;
  const doc = {
    agentId: 'abcdefgh',
    name: 'tricky-1',
    persona: 'custom',
    customPrompt: 'Plays "weird" lines\nand quotes \' ` ${x}',
    model: 'Qwen/Qwen3.6-35B-A3B-FP8',
    maxCalls: 40,
    eventId: null,
    walletAddress: 'tricky-1.hosted.local',
  } as unknown as HostedAgentDoc;

  it('pre-fills PERSONA as safe string literals', () => {
    const src = readFileSync(join(agentDir, 'src/strategy.ts'), 'utf8');
    const out = prefillStrategy(src, personaText('custom', 'tricky-1', doc.customPrompt));
    assert.ok(out.includes(JSON.stringify("and quotes ' ` ${x}")));
    assert.ok(!out.includes('disciplined tight-aggressive'));
    assert.ok(out.includes('export function buildSystemPrompt'));
  });

  it('is a valid .tar.gz with .env (no API key unless asked), README and the starter', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hosted-dl-'));
    try {
      for (const withKey of [false, true]) {
        const tgz = buildAgentBundle({
          doc,
          agentDir,
          privateKey: 'ed25519:PRIVATEKEYPLACEHOLDER',
          nearAiKey: withKey ? 'sk-user-key-1234' : null,
          gameServer: 'https://api.example.test',
          vaultId: 'vault.x.testnet',
          rpcUrl: 'https://rpc.example',
        });
        const f = join(dir, `a${withKey}.tgz`);
        writeFileSync(f, tgz);
        const out = join(dir, `x${withKey}`);
        execFileSync('mkdir', ['-p', out]);
        execFileSync('tar', ['-xzf', f, '-C', out]);
        const root = join(out, 'tricky-1-agent');
        const env = readFileSync(join(root, '.env'), 'utf8');
        assert.match(env, /AGENT_ACCOUNT=tricky-1\.hosted\.local/);
        assert.match(env, /AGENT_PRIVATE_KEY=ed25519:PRIVATEKEYPLACEHOLDER/);
        assert.match(env, /GAME_SERVER=https:\/\/api\.example\.test/);
        assert.equal(env.includes('sk-user-key-1234'), withKey);
        if (!withKey) assert.match(env, /NEARAI_API_KEY=paste-your-near-ai-key-here/);
        assert.match(readFileSync(join(root, 'README.md'), 'utf8'), /3 commands/);
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        assert.match(pkg.scripts.start, /--env-file=\.env/);
        for (const p of ['src/agent.ts', 'src/index.ts', 'src/near.ts', 'src/tee.ts', 'src/fairness.ts', 'test/mock-nearai.ts', 'tsconfig.json']) {
          readFileSync(join(root, p));
        }
        assert.match(readFileSync(join(root, 'src/strategy.ts'), 'utf8'), /tricky-1/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('near-mode wallet (stubbed chain: no RPC, no transactions)', () => {
  let mongod: MongoMemoryServer;
  before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri('hosted-unit'));
  });
  after(async () => {
    setChainOps(null);
    await mongoose.disconnect();
    await mongod.stop();
  });

  const cfg = () => ({ ...getHostedConfig({ CHAIN: 'near', HOSTED_ROOT: 'root.testnet', VAULT_ID: 'vault.root.testnet' }) });

  it('creates <name>.<root>, funds it, then deposits from the new account', async () => {
    const calls: string[] = [];
    const ops: ChainOps = {
      accountExists: async (id) => (calls.push(`exists ${id}`), false),
      funderAvailableYocto: async () => 10n ** 24n,
      createSubAccount: async (id, pk, near) => (calls.push(`create ${id} ${pk.slice(0, 8)} ${near}`), 'TXCREATE'),
      deposit: async (id, key, near) => (calls.push(`deposit ${id} ${key.startsWith('ed25519:')} ${near}`), 'TXDEP'),
    };
    setChainOps(() => ops);
    const w = await createWallet(cfg(), 'sharky');
    assert.equal(w.accountId, 'sharky.root.testnet');
    assert.deepEqual(w.txs, { createAccount: 'TXCREATE', deposit: 'TXDEP' });
    assert.deepEqual(calls, ['exists sharky.root.testnet', 'create sharky.root.testnet ed25519: 0.15', 'deposit sharky.root.testnet true 0.1']);
  });

  it('refuses when the funder is low or the name exists', async () => {
    setChainOps(() => ({
      accountExists: async () => false,
      funderAvailableYocto: async () => 10n ** 23n, // 0.1 NEAR < 0.15 + headroom
      createSubAccount: async () => assert.fail('must not create'),
      deposit: async () => assert.fail('must not deposit'),
    }));
    await assert.rejects(createWallet(cfg(), 'poor'), (e: WalletError) => e.status === 503 && /FunderLow/.test(e.message));
    setChainOps(() => ({
      accountExists: async () => true,
      funderAvailableYocto: async () => 10n ** 25n,
      createSubAccount: async () => assert.fail('must not create'),
      deposit: async () => assert.fail('must not deposit'),
    }));
    await assert.rejects(createWallet(cfg(), 'taken'), (e: WalletError) => e.status === 409);
  });

  it('keeps the funded account when the deposit fails', async () => {
    setChainOps(() => ({
      accountExists: async () => false,
      funderAvailableYocto: async () => 10n ** 25n,
      createSubAccount: async () => 'TX1',
      deposit: async () => {
        throw new Error('rpc down');
      },
    }));
    const w = await createWallet(cfg(), 'flaky');
    assert.equal(w.txs.createAccount, 'TX1');
    assert.match(w.depositError ?? '', /rpc down/);
  });
});

describe('funder key source', () => {
  it('HOSTED_FUNDER_PRIVATE_KEY wins over the key file and is validated', async () => {
    const { readFunderKey } = await import('./wallet.js');
    const cfg = getHostedConfig({ CHAIN: 'near', HOSTED_FUNDER_ACCOUNT: 'root.testnet', HOSTED_FUNDER_KEY_FILE: '/nonexistent.json' });
    assert.equal(cfg.root, 'root.testnet');
    assert.equal(cfg.funder, 'root.testnet');
    const k = 'ed25519:' + '3'.repeat(64);
    assert.equal(readFunderKey(cfg, { HOSTED_FUNDER_PRIVATE_KEY: k }), k);
    assert.throws(() => readFunderKey(cfg, { HOSTED_FUNDER_PRIVATE_KEY: 'nope' }), /HostedFunderMissing/);
    assert.throws(() => readFunderKey(cfg, {}), /HostedFunderMissing/);
  });
});
