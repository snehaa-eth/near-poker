/**
 * Local stand-in for NEAR AI Cloud (never call the real, paid API in tests).
 *
 *   POST /v1/chat/completions   OpenAI-style body; the reply echoes the turn challenge found in the
 *                               prompt ("Turn challenge: <hex>") and a scripted move.
 *   GET  /v1/signature/<id>?model=…&signing_algo=ed25519
 *        → { text: `${model}:${sha256(requestBody)}:${sha256(responseBody)}`, signature (hex), signing_address, signing_algo }
 *   GET  /v1/attestation/report?model=…&nonce=…&signing_algo=ed25519
 *        → { gateway_attestation, model_attestations: [{ signing_address, request_nonce: nonce, … }] }
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

export type ScriptedMove = { action: string; amount?: number; line?: string; wrongChallenge?: boolean; noJson?: boolean };

export type MockNearAi = {
  baseUrl: string; // http://127.0.0.1:<port>/v1
  signingAddress: string;
  completions: number;
  requests: Array<{ raw: Buffer; json: any }>;
  /** next replies (FIFO); default when empty: check if free else call */
  script: ScriptedMove[];
  rejectJsonMode: boolean;
  close(): Promise<void>;
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

export async function startMockNearAi(opts: { model?: string } = {}): Promise<MockNearAi> {
  const model = opts.model ?? 'Qwen/Qwen3.6-35B-A3B-FP8';
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signingAddress = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32).toString('hex');
  const sigs = new Map<string, { text: string; signature: string }>();

  const state: Omit<MockNearAi, 'baseUrl' | 'close'> = { signingAddress, completions: 0, requests: [], script: [], rejectJsonMode: false };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (code: number, body: string) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(body);
    };
    if (req.headers.authorization !== 'Bearer test-key') return send(401, '{"error":"unauthorized"}');

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const raw = await readBody(req);
      const json = JSON.parse(raw.toString('utf8'));
      if (state.rejectJsonMode && json.response_format) return send(400, '{"error":{"message":"response_format not supported"}}');
      state.completions += 1;
      state.requests.push({ raw, json });
      const user = String(json.messages?.find((m: any) => m.role === 'user')?.content ?? '');
      const challenge = /Turn challenge: ([0-9a-f]+)/.exec(user)?.[1] ?? '';
      const toCall = Number(/To call: (\d+)/.exec(user)?.[1] ?? 0);
      const s = state.script.shift() ?? { action: toCall === 0 ? 'check' : 'call' };
      const reply = s.noJson
        ? 'I think I will call here.'
        : JSON.stringify({
            challenge: s.wrongChallenge ? 'ff'.repeat(16) : challenge,
            action: s.action,
            ...(s.amount !== undefined ? { amount: s.amount } : {}),
            line: s.line ?? 'Nice and steady.',
          });
      const id = `chatcmpl-${randomBytes(16).toString('hex')}`;
      // Formatted like a vLLM body (non-ASCII in the line on purpose to exercise exact-byte hashing).
      const responseBody = JSON.stringify({
        id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: reply, reasoning_content: null, tool_calls: [] },
            logprobs: null,
            finish_reason: 'stop',
            stop_reason: null,
          },
        ],
        usage: { prompt_tokens: 512, total_tokens: 560, completion_tokens: 48, prompt_tokens_details: null },
        prompt_logprobs: null,
        kv_transfer_params: null,
        system_fingerprint: 'mock — “tee” ♠',
      });
      const text = `${model}:${sha(raw)}:${sha(Buffer.from(responseBody, 'utf8'))}`;
      sigs.set(id, { text, signature: sign(null, Buffer.from(text, 'utf8'), privateKey).toString('hex') });
      return send(200, responseBody);
    }

    const sm = /^\/v1\/signature\/(.+)$/.exec(url.pathname);
    if (req.method === 'GET' && sm) {
      const s = sigs.get(decodeURIComponent(sm[1]!));
      if (!s || url.searchParams.get('model') !== model || url.searchParams.get('signing_algo') !== 'ed25519') {
        return send(404, '{"error_code":"not_found"}');
      }
      return send(200, JSON.stringify({ text: s.text, signature: s.signature, signing_address: signingAddress, signing_algo: 'ed25519' }));
    }

    if (req.method === 'GET' && url.pathname === '/v1/attestation/report') {
      const nonce = url.searchParams.get('nonce') ?? '';
      if (url.searchParams.get('model') !== model) return send(200, JSON.stringify({ gateway_attestation: {}, model_attestations: [] }));
      return send(
        200,
        JSON.stringify({
          gateway_attestation: { signing_address: 'aa'.repeat(32), signing_algo: 'ed25519', request_nonce: nonce, intel_quote: 'deadbeef' },
          model_attestations: [
            { signing_address: signingAddress, signing_algo: 'ed25519', request_nonce: nonce, intel_quote: 'cafe', nvidia_payload: '{}' },
          ],
        }),
      );
    }
    send(404, '{"error":"not found"}');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  const mock = state as MockNearAi;
  mock.baseUrl = `http://127.0.0.1:${port}/v1`;
  mock.close = () => new Promise((ok) => server.close(() => ok()));
  return mock;
}
