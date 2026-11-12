'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { ChipAmount } from '~/components/currency-amount';
import { playSound } from '~/lib/sounds';
import { playActionSound } from '~/lib/table-sfx';
import { useSocket } from '~/providers/socket-provider';
import { cn, errorHandler } from '~/lib/utils';

import { toast } from 'sonner';

const PRESETS = [25, 33, 75, 133] as const;

export type LocalTableAction =
  | { type: 'fold' }
  | { type: 'bet'; amount: number };

interface ActionBarProps {
  gameId: string;
  isMyTurn: boolean;
  highestBet: number;
  myChipsInPot: number;
  stack: number;
  /** Min raise size (increment), from NLHE engine. */
  minRaiseIncrement?: number;
  disabled?: boolean;
  /** Offline / dummy table — skip socket and call this instead. */
  onLocalAction?: (action: LocalTableAction) => void;
}

export const ActionBar = ({
  gameId,
  isMyTurn,
  highestBet,
  myChipsInPot,
  stack,
  minRaiseIncrement = 1,
  disabled,
  onLocalAction,
}: ActionBarProps) => {
  const { socket } = useSocket();
  const canCheck = highestBet <= myChipsInPot;
  const toCall = Math.max(0, highestBet - myChipsInPot);
  /** Absolute street target for call (engine expects this or toCall). */
  const callTarget = highestBet;
  const minRaiseTo = Math.max(highestBet + minRaiseIncrement, highestBet + 1);
  const sliderMin = canCheck ? Math.max(minRaiseIncrement, 1) : minRaiseTo;
  const sliderMax = Math.max(stack + myChipsInPot, callTarget, minRaiseTo, 100);
  const [amount, setAmount] = useState(
    canCheck ? Math.max(Math.round(stack * 0.75), sliderMin) : minRaiseTo
  );
  const [preset, setPreset] = useState<number | null>(canCheck ? 75 : null);
  const lastSliderSoundAt = useRef(0);

  useEffect(() => {
    if (canCheck) {
      setAmount(Math.max(Math.round(stack * 0.75), sliderMin));
      setPreset(75);
    } else {
      setAmount(minRaiseTo);
      setPreset(null);
    }
  }, [canCheck, highestBet, minRaiseTo, sliderMin, stack]);

  const applyPreset = (pct: number) => {
    playSound('cardFlip', 0.4);
    setPreset(pct);
    const next = Math.max(sliderMin, Math.round((stack * pct) / 100));
    setAmount(Math.min(next, sliderMax));
  };

  const onSliderChange = (next: number) => {
    setPreset(null);
    setAmount(next);
    const now = performance.now();
    if (now - lastSliderSoundAt.current > 90) {
      lastSliderSoundAt.current = now;
      playSound('chipsBet', 0.22);
    }
  };

  const canAct =
    isMyTurn && !disabled && (Boolean(onLocalAction) || Boolean(socket));

  const emit = (event: string, payload: Record<string, unknown>) => {
    try {
      if (onLocalAction) {
        if (!isMyTurn) throw new Error('Not your turn.');
        if (event === 'game:fold') onLocalAction({ type: 'fold' });
        else if (event === 'game:bet') {
          onLocalAction({
            type: 'bet',
            amount: Number(payload.amount ?? 0),
          });
        }
        return;
      }
      if (!socket) throw new Error('Not connected.');
      if (!isMyTurn) throw new Error('Not your turn.');
      socket.emit(event, payload);
    } catch (error) {
      toast.error(errorHandler(error));
    }
  };

  const onFold = () => {
    playActionSound('fold');
    emit('game:fold', { gameId });
  };
  const onCheck = () => {
    playActionSound('check');
    emit('game:bet', { gameId, amount: 0 });
  };
  const onCall = () => {
    playActionSound('call', { allIn: toCall >= stack });
    emit('game:bet', { gameId, amount: callTarget });
  };
  const onBetOrRaise = () => {
    if (amount < sliderMin) {
      toast.error(
        canCheck
          ? 'Bet must be at least 1.'
          : 'Raise must be higher than the current bet.'
      );
      return;
    }
    const allIn = amount >= stack + myChipsInPot;
    playActionSound(canCheck ? 'bet' : 'raise', { allIn });
    emit('game:bet', { gameId, amount });
  };

  const clamped = Math.min(Math.max(amount, sliderMin), sliderMax);
  const fillPct = useMemo(() => {
    if (sliderMax <= sliderMin) return 100;
    return ((clamped - sliderMin) / (sliderMax - sliderMin)) * 100;
  }, [clamped, sliderMin, sliderMax]);

  const primaryLabel = canCheck ? 'Bet' : 'Raise';

  return (
    <div className='pointer-events-auto mx-auto w-full max-w-xl px-4 pb-6 pt-2'>
      <div className='flex flex-col items-center gap-2.5'>
        {/* Sizing bar */}
        <div className='flex w-full items-center gap-2 rounded-full border border-neutral-200/90 bg-white px-3 py-2 shadow-[0_4px_24px_rgba(0,0,0,0.05)] sm:gap-3 sm:px-4 sm:py-2.5'>
          <div className='flex shrink-0 items-center gap-0.5'>
            {PRESETS.map((p) => (
              <button
                key={p}
                type='button'
                className={cn(
                  'rounded-full px-2 py-1 text-[12px] font-semibold tabular-nums transition-colors sm:px-2.5',
                  preset === p
                    ? 'bg-neutral-100 text-neutral-900'
                    : 'text-neutral-400 hover:text-neutral-700'
                )}
                disabled={!canAct}
                onClick={() => applyPreset(p)}
              >
                {p}%
              </button>
            ))}
          </div>

          <div className='relative mx-0.5 min-w-0 flex-1'>
            <div className='pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-neutral-200'>
              <div
                className='h-full rounded-full bg-[#1D9BF0]'
                style={{ width: `${fillPct}%` }}
              />
            </div>
            <input
              aria-label='Bet amount'
              className={cn(
                'relative z-10 h-5 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-40',
                '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent',
                '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-neutral-200 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.18)] [&::-webkit-slider-thumb]:-mt-[5px]',
                '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent',
                '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-neutral-200 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.18)]'
              )}
              disabled={!canAct}
              max={sliderMax}
              min={sliderMin}
              step={1}
              type='range'
              value={clamped}
              onChange={(e) => onSliderChange(Number(e.target.value))}
            />
          </div>

          <div className='flex shrink-0 items-center'>
            <ChipAmount
              value={clamped}
              size='sm'
              className='text-[13px] sm:text-sm'
              iconClassName='h-4 w-4'
            />
          </div>
        </div>

        {/* Action bar */}
        <div className='flex w-full max-w-md items-center gap-1.5 rounded-full border border-neutral-200/90 bg-white p-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.05)] sm:gap-2 sm:p-2'>
          <button
            type='button'
            className='inline-flex min-w-[4.25rem] items-center justify-center rounded-full px-3 py-2.5 text-[13px] font-semibold text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-800 disabled:opacity-35'
            disabled={!canAct}
            onClick={onFold}
          >
            Fold
          </button>

          {canCheck ? (
            <button
              type='button'
              className='inline-flex min-w-0 flex-1 items-center justify-center rounded-full bg-neutral-100 px-3 py-2.5 text-[13px] font-semibold text-neutral-900 transition hover:bg-neutral-200/80 active:scale-[0.98] disabled:opacity-35'
              disabled={!canAct}
              onClick={onCheck}
            >
              Check
            </button>
          ) : (
            <button
              type='button'
              className='inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-neutral-100 px-3 py-2.5 text-[13px] font-semibold text-neutral-900 transition hover:bg-neutral-200/80 active:scale-[0.98] disabled:opacity-35'
              disabled={!canAct}
              onClick={onCall}
            >
              <span>Call</span>
              <ChipAmount
                value={toCall}
                size='sm'
                className='text-[13px]'
                iconClassName='h-3.5 w-3.5'
              />
            </button>
          )}

          <button
            type='button'
            className='inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-neutral-950 px-3 py-2.5 text-[13px] font-semibold text-white transition hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-35'
            disabled={!canAct}
            onClick={onBetOrRaise}
          >
            <span>{primaryLabel}</span>
            <ChipAmount
              value={clamped}
              size='sm'
              className='text-[13px] text-white'
              iconClassName='h-3.5 w-3.5'
            />
          </button>
        </div>

        {!isMyTurn ? (
          <p className='text-[12px] text-neutral-400'>Waiting for other players…</p>
        ) : null}
      </div>
    </div>
  );
};
