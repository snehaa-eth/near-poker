'use client';

import React, { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import { type ArenaEventOption, type HostedConfig, type HostedCreated, hostedApi } from '~/lib/api';
import { AGENTS_MD_URL } from '~/lib/arena';
import { cn } from '~/lib/utils';

import { Button, buttonVariants } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Field, RadioCard, describedBy } from '~/components/ui/field';
import { inputClass } from '~/components/ui/input';
import { Skeleton } from '~/components/ui/skeleton';
import { ErrorState } from '~/components/ui/states';
import { Term } from '~/components/ui/term';

import { AlertCircle, ArrowRight, ArrowUpRight, Check, Copy, Loader2, PauseCircle } from 'lucide-react';

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
  if (!name) return 'Pick a name for your agent.';
  if (name.length < 3) return 'Use at least 3 characters.';
  if (name.length > 20) return 'Use at most 20 characters.';
  if (!NAME_RE.test(name)) return 'Use only lowercase letters, digits and dashes.';
  if (name.startsWith('-') || name.endsWith('-') || name.includes('--')) return 'Put dashes only between letters or digits.';
  return null;
}

/** Friendly state when the server can't host agents (never shows env/config details). */
function HostedPaused() {
  return (
    <Card className='flex flex-col gap-4'>
      <div className='flex items-start gap-3'>
        <PauseCircle className='mt-0.5 size-6 shrink-0 text-warning' aria-hidden strokeWidth={1.75} />
        <div>
          <h2 className='text-h3 font-semibold'>Hosted agents are paused right now</h2>
          <p className='mt-1 text-body text-fg-muted'>
            We can’t create new hosted agents at the moment. You can still bring your own agent with the starter kit, or
            watch the tables while you wait.
          </p>
        </div>
      </div>
      <div className='flex flex-wrap gap-2'>
        <a href={AGENTS_MD_URL} target='_blank' rel='noopener noreferrer' className={buttonVariants({ variant: 'primary' })}>
          Bring your own agent <ArrowUpRight aria-hidden />
        </a>
        <Link href='/arena' className={buttonVariants({ variant: 'secondary' })}>
          Watch the arena
        </Link>
      </div>
    </Card>
  );
}

export function NewAgentForm() {
  const [config, setConfig] = useState<HostedConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
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
  const [touched, setTouched] = useState<{ name?: boolean; key?: boolean; custom?: boolean }>({});
  const [created, setCreated] = useState<(HostedCreated & { name: string; started: boolean }) | null>(null);

  const loadConfig = () => {
    setLoadingConfig(true);
    setConfigError(false);
    hostedApi
      .config()
      .then((c) => {
        setConfig(c);
        setModel((m) => m || c.defaultModel);
        setMaxCalls(c.maxCallsDefault);
      })
      .catch(() => setConfigError(true))
      .finally(() => setLoadingConfig(false));
  };

  useEffect(() => {
    loadConfig();
    hostedApi.events().then(setEvents).catch(() => setEvents(null));
  }, []);

  const personas = config?.personas ?? FALLBACK_PERSONAS;
  const customMax = config?.customMax ?? 600;
  const nameErr = nameProblem(name);
  const keyErr = apiKey.trim().length >= 8 ? null : 'Paste your NEAR AI API key (it starts with sk-).';
  const customErr =
    persona !== 'custom' || (custom.trim().length >= 10 && custom.length <= customMax)
      ? null
      : 'Describe the style in at least 10 characters.';
  const valid = !nameErr && !keyErr && !customErr;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ name: true, key: true, custom: true });
    if (!valid || busy) return;
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
  if (loadingConfig) return <Skeleton className='h-96 rounded-md' />;
  if (configError)
    return (
      <ErrorState onRetry={loadConfig} title='The arena server isn’t responding'>
        We can’t check whether hosted agents are available right now.
      </ErrorState>
    );
  if (config && !config.enabled) return <HostedPaused />;

  const showName = touched.name && nameErr;
  const showKey = touched.key && keyErr;
  const showCustom = touched.custom && customErr;

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      <Card className='flex flex-col gap-6'>
        <p className='text-caption text-fg-muted'>
          We create a NEAR <Term t='testnet'>testnet</Term> wallet for your agent, fund it with free test NEAR, and run it
          on our server. You can download the code anytime.
        </p>

        <Field id='agent-name' label='Agent name' error={showName ? nameErr : null} hint='3–20 characters: lowercase letters, digits, dashes. It becomes the wallet name.'>
          <input
            id='agent-name'
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            placeholder='e.g. midnight-shark'
            maxLength={20}
            autoComplete='off'
            spellCheck={false}
            aria-invalid={Boolean(showName)}
            aria-describedby={describedBy('agent-name', Boolean(showName))}
          />
        </Field>

        <fieldset>
          <legend className='text-caption font-semibold text-fg'>Playing style</legend>
          <div className='mt-2 grid gap-2 sm:grid-cols-2'>
            {personas.map((p) => (
              <RadioCard
                key={p.id}
                name='persona'
                value={p.id}
                checked={persona === p.id}
                onChange={setPersona}
                title={p.label}
                description={p.blurb}
                className={cn(p.id === 'custom' && 'sm:col-span-2')}
              />
            ))}
          </div>
          {persona === 'custom' ? (
            <Field
              id='custom-style'
              className='mt-4'
              label='Describe the style'
              error={showCustom ? customErr : null}
              hint={`${custom.length}/${customMax}. Private: only you see it.`}
            >
              <textarea
                id='custom-style'
                className={cn(inputClass, 'h-auto min-h-[110px] resize-y py-2')}
                value={custom}
                maxLength={customMax}
                onChange={(e) => setCustom(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, custom: true }))}
                aria-invalid={Boolean(showCustom)}
                aria-describedby={describedBy('custom-style', Boolean(showCustom))}
                placeholder='e.g. A patient grinder who folds a lot preflop but bets big when it hits.'
              />
            </Field>
          ) : null}
        </fieldset>

        <Field
          id='nearai-key'
          label='NEAR AI API key'
          error={showKey ? keyErr : null}
          hint={
            <>
              Get one at{' '}
              <a href='https://cloud.near.ai' target='_blank' rel='noopener noreferrer' className='link font-semibold'>
                cloud.near.ai
              </a>{' '}
              and add about $1 of credit (a move costs ≈ $0.0002). We store it encrypted and use it only to run your agent.
            </>
          }
        >
          <input
            id='nearai-key'
            type='password'
            className={inputClass}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, key: true }))}
            placeholder='sk-…'
            autoComplete='off'
            aria-invalid={Boolean(showKey)}
            aria-describedby={describedBy('nearai-key', Boolean(showKey))}
          />
        </Field>

        <details className='rounded-sm border border-border px-4 py-3'>
          <summary className='flex min-h-11 cursor-pointer items-center text-caption font-semibold text-fg sm:min-h-0'>Advanced</summary>
          <div className='mt-4 flex flex-col gap-6'>
            <Field id='model' label='Model' hint='Must be a NEAR AI confidential (TEE) model. We check before creating your agent.'>
              <input id='model' className={cn(inputClass, 'font-mono text-caption')} value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} aria-describedby='model-hint' />
            </Field>
            <Field
              id='max-calls'
              label='Max AI calls per run'
              hint={`About one call per move. ${maxCalls} calls ≈ $${(maxCalls * 0.0002).toFixed(3)}. The agent stops when they’re used; press Play for another run.`}
            >
              <input
                id='max-calls'
                type='number'
                min={4}
                max={500}
                className={cn(inputClass, 'w-32 tabular-nums')}
                value={maxCalls}
                onChange={(e) => setMaxCalls(Math.max(4, Math.min(500, Number(e.target.value) || 40)))}
                aria-describedby='max-calls-hint'
              />
            </Field>
            {events && events.length > 0 ? (
              <Field id='event' label='Register for an event' optional>
                <select id='event' className={inputClass} value={eventId} onChange={(e) => setEventId(e.target.value)}>
                  <option value=''>No event: just play the open arena</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                      {ev.startsAt ? ` · ${new Date(ev.startsAt).toLocaleString()}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
        </details>

        {error ? (
          <p role='alert' className='flex items-start gap-2 rounded-sm border border-negative/40 bg-negative/10 px-4 py-3 text-caption text-fg'>
            <AlertCircle className='mt-0.5 size-4 shrink-0 text-negative' aria-hidden />
            {error}
          </p>
        ) : null}

        <div>
          <Button type='submit' size='lg' className='w-full' disabled={busy}>
            {busy ? (
              <>
                <Loader2 className='animate-spin' aria-hidden /> Creating the wallet and funding it (up to 30 s)…
              </>
            ) : (
              <>
                Create my agent <ArrowRight aria-hidden />
              </>
            )}
          </Button>
          <p className='mt-3 text-center text-caption text-fg-subtle'>
            {config?.chain === 'near'
              ? `We send ${config.fundNear} test NEAR and deposit ${config.depositNear} (${Math.round(config.depositNear * 1000)} chips) for you. Testnet only, no real money. Your NEAR AI credit pays for the moves.`
              : 'Testnet / local server only. No real money.'}
          </p>
        </div>
      </Card>
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
      return 'That model isn’t a confidential (TEE) model on NEAR AI Cloud, so it can’t play. Use the default.';
    default:
      if (/HOSTED_SECRET|not configured/i.test(msg)) return 'Hosted agents are paused right now. Try again later or bring your own agent.';
      if (/failed to fetch|networkerror/i.test(msg)) return 'Can’t reach the arena server. Check your connection and try again.';
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
    <Card className='flex flex-col gap-6'>
      <div>
        <p className='eyebrow'>Agent created</p>
        <h2 className='mt-2 text-h2 font-semibold'>{created.name} is in</h2>
        <p className='mt-2 text-body text-fg-muted'>
          {created.started
            ? 'It’s joining the arena now and sits down as soon as an opponent is free.'
            : 'Open your agent page and press Play to send it to the arena.'}
        </p>
        {created.warning ? (
          <p className='mt-3 rounded-sm border border-warning/40 bg-warning/10 px-4 py-3 text-caption text-fg'>{created.warning}</p>
        ) : null}
      </div>

      <div className='rounded-sm border border-accent/50 bg-accent-soft p-4'>
        <p className='font-semibold'>Save this link. It’s the only key to your agent.</p>
        <p className='mt-1 text-caption text-fg-muted'>
          We show it once. Anyone with it can stop, edit or download your agent (including its wallet key). This browser
          also remembers it.
        </p>
        <p className='mt-3 break-all rounded-xs bg-bg px-3 py-2 font-mono text-[12px] text-fg'>{fullUrl}</p>
        <Button
          variant='secondary'
          className='mt-3'
          onClick={() => {
            void navigator.clipboard.writeText(fullUrl).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            });
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          <span aria-live='polite'>{copied ? 'Copied' : 'Copy link'}</span>
        </Button>
      </div>

      <dl className='grid grid-cols-1 gap-3 text-caption sm:grid-cols-2'>
        <div>
          <dt className='text-fg-subtle'>Wallet</dt>
          <dd className='mt-1 break-all font-mono text-[12px]'>{created.walletAddress}</dd>
        </div>
        {created.txs.deposit ? (
          <div>
            <dt className='text-fg-subtle'>Vault deposit</dt>
            <dd className='mt-1'>
              <a href={`https://testnet.nearblocks.io/txns/${created.txs.deposit}`} target='_blank' rel='noopener noreferrer' className='link inline-flex items-center gap-1 font-semibold'>
                View on NEAR <ArrowUpRight className='size-3.5' aria-hidden />
              </a>
            </dd>
          </div>
        ) : null}
      </dl>

      <Link href={created.manageUrl} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
        Open my agent <ArrowRight aria-hidden />
      </Link>
    </Card>
  );
}
