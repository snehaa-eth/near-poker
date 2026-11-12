'use client';

import React, { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import {
  type ArenaEventOption,
  type HostedConfig,
  type HostedCreated,
  hostedApi,
} from '~/lib/api';
import { cn } from '~/lib/utils';

import { ArrowUpRight, Check, Copy, Loader2 } from 'lucide-react';

import { saveAgent } from './saved-agents';

const NAME_RE = /^[a-z0-9-]{3,20}$/;
const FALLBACK_PERSONAS = [
  { id: 'shark', label: 'Shark', blurb: 'Aggressive. Raises often, puts opponents to hard decisions.' },
  { id: 'rock', label: 'Rock', blurb: 'Tight. Waits for strong hands and plays them hard.' },
  { id: 'trickster', label: 'Trickster', blurb: 'Bluffy and unpredictable. Mixes up its play.' },
  { id: 'calculator', label: 'Calculator', blurb: 'Math first. Pot odds, equity and position.' },
  { id: 'custom', label: 'Custom', blurb: 'Describe the style yourself.' },
];

function nameProblem(name: string): string | null {
  if (!name) return null;
  if (name.length < 3) return 'At least 3 characters.';
  if (name.length > 20) return 'At most 20 characters.';
  if (!NAME_RE.test(name)) return 'Only lowercase letters, digits and dashes.';
  if (name.startsWith('-') || name.endsWith('-') || name.includes('--')) return 'Dashes only between letters or digits.';
  return null;
}

const label = 'block text-sm font-semibold text-neutral-950';
const hint = 'mt-1 text-xs text-neutral-500';
const field =
  'mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-neutral-900';

export function NewAgentForm() {
  const [config, setConfig] = useState<HostedConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [events, setEvents] = useState<ArenaEventOption[] | null>(null);

  const [name, setName] = useState('');
  const [persona, setPersona] = useState('shark');
  const [custom, setCustom] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [maxCalls, setMaxCalls] = useState(40);
  const [eventId, setEventId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<(HostedCreated & { name: string; started: boolean }) | null>(null);

  useEffect(() => {
    hostedApi
      .config()
      .then((c) => {
        setConfig(c);
        setModel((m) => m || c.defaultModel);
        setMaxCalls(c.maxCallsDefault);
      })
      .catch((e: Error) => setConfigError(e.message));
    hostedApi.events().then(setEvents).catch(() => setEvents(null));
  }, []);

  const personas = config?.personas ?? FALLBACK_PERSONAS;
  const customMax = config?.customMax ?? 600;
  const nameErr = nameProblem(name);
  const disabled = config ? !config.enabled : false;
  const canSubmit =
    !busy &&
    !disabled &&
    !nameErr &&
    name.length >= 3 &&
    apiKey.trim().length >= 8 &&
    (persona !== 'custom' || (custom.trim().length >= 10 && custom.length <= customMax));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const r = await hostedApi.create({
        name,
        persona,
        customPrompt: persona === 'custom' ? custom : undefined,
        model: model.trim() || undefined,
        nearAiKey: apiKey.trim(),
        maxCalls,
        eventId: eventId || undefined,
      });
      saveAgent({ id: r.agentId, name, token: r.ownerToken });
      setApiKey('');
      let started = false;
      if (!r.warning) {
        started = await hostedApi
          .play(r.agentId, r.ownerToken)
          .then(() => true)
          .catch(() => false);
      }
      setCreated({ ...r, name, started });
    } catch (err) {
      setError(friendly((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  if (created) return <CreatedPanel created={created} />;

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className='rounded-2xl border border-neutral-200 bg-white p-6 shadow-[0_24px_80px_rgba(0,0,0,0.08)] sm:p-8'
    >
      <div className='rounded-xl bg-[#E8F5EE] px-4 py-3 text-[13px] leading-relaxed text-neutral-800'>
        We create a NEAR testnet wallet for your agent, fund it with free test NEAR, and run it on
        our server. You can download it anytime.
      </div>

      {configError ? (
        <p className='mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700'>
          Cannot reach the game server ({configError}).
        </p>
      ) : null}
      {config && !config.enabled ? (
        <p className='mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800'>
          {config.reason ?? 'Hosted agents are turned off on this server.'}
        </p>
      ) : null}

      <div className='mt-6 space-y-6'>
        <div>
          <label htmlFor='agent-name' className={label}>
            Agent name
          </label>
          <input
            id='agent-name'
            className={cn(field, nameErr && 'border-red-400')}
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
            placeholder='e.g. midnight-shark'
            maxLength={20}
            autoComplete='off'
            spellCheck={false}
          />
          <p className={cn(hint, nameErr && 'text-red-600')}>
            {nameErr ?? '3–20 characters: lowercase letters, digits, dashes. It becomes your wallet name.'}
          </p>
        </div>

        <fieldset>
          <legend className={label}>Personality</legend>
          <div className='mt-2 grid gap-2 sm:grid-cols-2'>
            {personas.map((p) => (
              <button
                type='button'
                key={p.id}
                onClick={() => setPersona(p.id)}
                aria-pressed={persona === p.id}
                className={cn(
                  'rounded-xl border px-3.5 py-3 text-left transition',
                  persona === p.id
                    ? 'border-neutral-950 bg-neutral-950 text-white'
                    : 'border-neutral-200 bg-white text-neutral-900 hover:border-neutral-400',
                  p.id === 'custom' && 'sm:col-span-2'
                )}
              >
                <span className='text-sm font-semibold'>{p.label}</span>
                <span className={cn('mt-0.5 block text-xs', persona === p.id ? 'text-neutral-300' : 'text-neutral-500')}>
                  {p.blurb}
                </span>
              </button>
            ))}
          </div>
          {persona === 'custom' ? (
            <div className='mt-3'>
              <textarea
                aria-label='Custom personality'
                className={cn(field, 'min-h-[110px] resize-y')}
                value={custom}
                maxLength={customMax}
                onChange={(e) => setCustom(e.target.value)}
                placeholder='e.g. A patient grinder who folds a lot preflop but bets big when it hits. Talks like a 1920s gangster.'
              />
              <p className={hint}>
                {custom.length}/{customMax}. This stays private: only you see it.
              </p>
            </div>
          ) : null}
        </fieldset>

        <div>
          <label htmlFor='nearai-key' className={label}>
            NEAR AI API key
          </label>
          <input
            id='nearai-key'
            type='password'
            className={field}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder='sk-…'
            autoComplete='off'
          />
          <p className={hint}>
            Get a key at{' '}
            <a href='https://cloud.near.ai' target='_blank' rel='noopener noreferrer' className='font-medium text-neutral-800 underline'>
              cloud.near.ai
            </a>{' '}
            and add ~$1 credit; each move ≈ $0.0002. We store it encrypted and only use it to run your agent.
          </p>
        </div>

        <details className='group rounded-xl border border-neutral-200 px-4 py-3'>
          <summary className='cursor-pointer text-sm font-semibold text-neutral-800'>Advanced</summary>
          <div className='mt-4 space-y-5'>
            <div>
              <label htmlFor='model' className={label}>
                Model
              </label>
              <input
                id='model'
                className={field}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                spellCheck={false}
              />
              <p className={hint}>Must be a NEAR AI Confidential-TEE model. We check it before creating your agent.</p>
            </div>
            <div>
              <label htmlFor='max-calls' className={label}>
                Max AI calls per run
              </label>
              <input
                id='max-calls'
                type='number'
                min={4}
                max={500}
                className={cn(field, 'w-32')}
                value={maxCalls}
                onChange={(e) => setMaxCalls(Math.max(4, Math.min(500, Number(e.target.value) || 40)))}
              />
              <p className={hint}>
                About one call per move. {maxCalls} calls ≈ ${(maxCalls * 0.0002).toFixed(3)}. Your agent stops when they are used; press Play again for another run.
              </p>
            </div>
            {events && events.length > 0 ? (
              <div>
                <label htmlFor='event' className={label}>
                  Register for event
                </label>
                <select id='event' className={field} value={eventId} onChange={(e) => setEventId(e.target.value)}>
                  <option value=''>No event: just play the open arena</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                      {ev.startsAt ? ` · ${new Date(ev.startsAt).toLocaleString()}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        </details>
      </div>

      {error ? <p className='mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700'>{error}</p> : null}

      <button
        type='submit'
        disabled={!canSubmit}
        className='mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#B8F06E] px-4 py-3.5 text-sm font-semibold text-neutral-950 transition hover:bg-[#a8e45a] disabled:cursor-not-allowed disabled:opacity-50'
      >
        {busy ? (
          <>
            <Loader2 className='h-4 w-4 animate-spin' /> Creating wallet and funding it… (up to 30s)
          </>
        ) : (
          'Create my agent →'
        )}
      </button>
      <p className='mt-3 text-center text-xs text-neutral-500'>
        {config?.chain === 'near'
          ? `Free: we send ${config.fundNear} test NEAR and deposit ${config.depositNear} NEAR (${Math.round(config.depositNear * 1000)} chips) for you. Testnet only, no real money.`
          : 'Testnet / local server only. No real money.'}
      </p>
    </form>
  );
}

function friendly(msg: string): string {
  const [code, ...rest] = msg.split(':');
  const detail = rest.join(':').trim();
  switch (code) {
    case 'NameTaken':
      return 'That name is taken. Try another one.';
    case 'RateLimited':
      return `Slow down: ${detail || 'too many new agents from your network this hour.'}`;
    case 'ModelNotAttested':
      return 'That model is not a Confidential-TEE model on NEAR AI Cloud, so it cannot play. Use the default.';
    default:
      return detail || msg;
  }
}

function CreatedPanel({ created }: { created: HostedCreated & { name: string; started: boolean } }) {
  const fullUrl = useMemo(
    () => (typeof window === 'undefined' ? created.manageUrl : `${window.location.origin}${created.manageUrl}`),
    [created.manageUrl]
  );
  const [copied, setCopied] = useState(false);
  return (
    <div className='rounded-2xl border border-neutral-200 bg-white p-6 shadow-[0_24px_80px_rgba(0,0,0,0.08)] sm:p-8'>
      <p className='text-sm text-neutral-500'>Agent created</p>
      <h2 className='mt-2 font-poker text-4xl tracking-wide text-neutral-950'>{created.name} is in.</h2>
      <p className='mt-3 text-sm text-neutral-600'>
        {created.started
          ? 'It is joining the arena now and will be seated as soon as an opponent is free.'
          : 'Open your agent page and press Play to send it to the arena.'}
      </p>
      {created.warning ? <p className='mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800'>{created.warning}</p> : null}

      <div className='mt-6 rounded-xl border-2 border-neutral-950 bg-neutral-50 p-4'>
        <p className='text-sm font-semibold text-neutral-950'>Save this link. It is the only key to your agent.</p>
        <p className='mt-1 text-xs text-neutral-600'>
          We show it once. Anyone with it can stop, edit or download your agent (including its wallet key). This browser also remembers it.
        </p>
        <div className='mt-3 break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-neutral-800'>{fullUrl}</div>
        <button
          type='button'
          onClick={() => {
            void navigator.clipboard.writeText(fullUrl).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            });
          }}
          className='mt-3 inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-100'
        >
          {copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
          {copied ? 'copied' : 'copy link'}
        </button>
      </div>

      <dl className='mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2'>
        <div>
          <dt className='text-xs text-neutral-500'>Wallet</dt>
          <dd className='mt-0.5 break-all font-mono text-xs'>{created.walletAddress}</dd>
        </div>
        {created.txs.deposit ? (
          <div>
            <dt className='text-xs text-neutral-500'>Vault deposit</dt>
            <dd className='mt-0.5'>
              <a href={`https://testnet.nearblocks.io/txns/${created.txs.deposit}`} target='_blank' rel='noopener noreferrer' className='inline-flex items-center text-xs font-medium underline'>
                view tx <ArrowUpRight className='ml-0.5 h-3 w-3' />
              </a>
            </dd>
          </div>
        ) : null}
      </dl>

      <Link
        href={created.manageUrl}
        className='mt-6 flex w-full items-center justify-center rounded-xl bg-[#B8F06E] px-4 py-3.5 text-sm font-semibold text-neutral-950 hover:bg-[#a8e45a]'
      >
        Open my agent →
      </Link>
    </div>
  );
}
