/**
 * "Download my agent": a .tar.gz of agent-starter with
 *   - src/strategy.ts  PERSONA pre-filled with the agent's personality
 *   - .env             AGENT_ACCOUNT, AGENT_PRIVATE_KEY, GAME_SERVER, model, budget, and
 *                      NEARAI_API_KEY (placeholder unless the owner opted in)
 *   - package.json     scripts load .env (tsx --env-file=.env)
 *   - README-HOSTED.md "run it yourself in 3 commands"
 * Written with a minimal ustar writer (no extra dependency).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import type { HostedAgentDoc } from '../db.js';
import { personaLabel, personaText, type PersonaId } from './personas.js';

type Entry = { path: string; data: Buffer; mode?: number };

function header(path: string, size: number, mode: number): Buffer {
  const h = Buffer.alloc(512, 0);
  let name = path;
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const i = path.lastIndexOf('/', 154);
    prefix = path.slice(0, i);
    name = path.slice(i + 1);
  }
  h.write(name, 0, 100, 'utf8');
  h.write(mode.toString(8).padStart(7, '0') + '\0', 100, 8, 'ascii');
  h.write('0000000\0', 108, 8, 'ascii'); // uid
  h.write('0000000\0', 116, 8, 'ascii'); // gid
  h.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii'); // checksum placeholder
  h.write('0', 156, 1, 'ascii'); // regular file
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}

export function tarGz(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    parts.push(header(e.path, e.data.length, e.mode ?? 0o644), e.data);
    const pad = (512 - (e.data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(parts));
}

/** Replace the `export const PERSONA = …;` block of strategy.ts with the agent's persona. */
export function prefillStrategy(source: string, persona: string): string {
  const lines = persona.split('\n').map((l) => `  ${JSON.stringify(l)},`);
  const block = `export const PERSONA = process.env.AGENT_PERSONA?.trim() || [\n${lines.join('\n')}\n].join('\\n');`;
  const re = /export const PERSONA =[\s\S]*?\]\.join\('\\n'\);/;
  if (!re.test(source)) throw new Error('strategy.ts PERSONA block not found');
  return source.replace(re, () => block);
}

const envLine = (k: string, v: string) => `${k}=${/[\s#"']/.test(v) ? JSON.stringify(v) : v}`;

export type BundleInput = {
  doc: HostedAgentDoc;
  agentDir: string;
  privateKey: string;
  nearAiKey: string | null;
  gameServer: string;
  vaultId: string | null;
  rpcUrl: string;
};

export function buildAgentBundle(b: BundleInput): Buffer {
  const { doc } = b;
  const root = `${doc.name}-agent`;
  const read = (p: string) => readFileSync(join(b.agentDir, p));
  const entries: Entry[] = [];
  const add = (p: string, data: Buffer | string, mode?: number) =>
    entries.push({ path: `${root}/${p}`, data: Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'), mode });

  const pkg = JSON.parse(read('package.json').toString('utf8')) as { name: string; scripts: Record<string, string> };
  pkg.name = `${doc.name}-agent`;
  pkg.scripts = {
    ...pkg.scripts,
    start: 'tsx --env-file=.env src/index.ts play',
    deposit: 'tsx --env-file=.env src/index.ts deposit',
    balance: 'tsx --env-file=.env src/index.ts balance',
  };
  add('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  for (const f of ['package-lock.json', 'tsconfig.json']) if (existsSync(join(b.agentDir, f))) add(f, read(f));

  for (const dir of ['src', 'test']) {
    for (const f of readdirSync(join(b.agentDir, dir)).sort()) {
      const rel = `${dir}/${f}`;
      if (!f.endsWith('.ts') || !statSync(join(b.agentDir, rel)).isFile()) continue;
      if (rel === 'src/strategy.ts') {
        add(rel, prefillStrategy(read(rel).toString('utf8'), personaText(doc.persona as PersonaId, doc.name, doc.customPrompt)));
      } else add(rel, read(rel));
    }
  }

  const env = [
    `# ${doc.name}: Dark Table hosted agent. KEEP THIS FILE SECRET (it holds your agent's private key).`,
    envLine('AGENT_ACCOUNT', doc.walletAddress),
    envLine('AGENT_PRIVATE_KEY', b.privateKey),
    envLine('AGENT_NICKNAME', doc.name),
    b.nearAiKey ? envLine('NEARAI_API_KEY', b.nearAiKey) : '# get a key at https://cloud.near.ai (add ~$1 credit)\nNEARAI_API_KEY=paste-your-near-ai-key-here',
    envLine('NEARAI_MODEL', doc.model),
    envLine('MAX_LLM_CALLS', String(doc.maxCalls)),
    envLine('GAME_SERVER', b.gameServer),
    ...(b.vaultId ? [envLine('VAULT_ID', b.vaultId), envLine('NEAR_RPC_URL', b.rpcUrl)] : []),
    ...(doc.eventId ? [envLine('EVENT_ID', doc.eventId)] : []),
    '',
  ].join('\n');
  add('.env', env, 0o600);
  add('.gitignore', 'node_modules\n.env\n');

  const readme = `# ${doc.name}: your Dark Table agent

Personality: **${personaLabel(doc.persona)}** · model \`${doc.model}\` · wallet \`${doc.walletAddress}\`

This is the same agent the Dark Table server was running for you, as a standalone
[agent-starter](https://github.com/) project. Your persona is pre-filled in \`src/strategy.ts\`.

## Run it yourself in 3 commands

\`\`\`bash
cd ${root}
npm install
npm start
\`\`\`

(Node 20.10 or newer.) ${b.nearAiKey ? '' : 'First open `.env` and paste your NEAR AI Cloud API key into `NEARAI_API_KEY` (get one at https://cloud.near.ai and add about $1 of credit; each move costs about $0.0002).'}

- \`npm run balance\` shows your chips in the table vault (1 chip = 0.001 NEAR).
- \`npm run deposit -- 0.1\` deposits 0.1 NEAR more (= 100 chips; 100 is the minimum to join).
- Edit \`src/strategy.ts\` to change how your agent thinks. Every move must still come from a
  NEAR AI Cloud Confidential-TEE model; the server rejects anything else.
- \`npm test\` runs offline tests against a local mock of NEAR AI (no cost).

## Keep \`.env\` secret

\`AGENT_PRIVATE_KEY\` controls your agent's NEAR testnet account and its chips. Do not commit or share it.
To withdraw chips, call \`withdraw({amount})\` on the vault contract from this account
(you cannot withdraw while your agent is in an unsettled hand).

Protocol and rules: AGENTS.md in the Dark Table repository.
`;
  add('README.md', readme);
  return tarGz(entries);
}
