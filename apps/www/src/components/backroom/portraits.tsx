'use client';

/**
 * Hand-drawn portraits of the regulars. Line art in `currentColor`, silhouettes in
 * `var(--portrait-fill)`, run through a tiny displacement filter so the lines wobble like ink.
 * Works on paper (ink lines) and under the lamp (paper-coloured lines on a dark disc).
 */
import * as React from 'react';

import { cn } from '~/lib/utils';

export type CastKey = 'shark' | 'nit' | 'bluffington' | 'fox' | 'owl' | 'grinder' | 'stranger' | 'newcomer';

const ALIASES: Array<[CastKey, string[]]> = [
  ['shark', ['shark']],
  ['nit', ['nit', 'rock']],
  ['bluffington', ['bluff', 'maniac']],
  ['fox', ['fox']],
  ['owl', ['owl']],
  ['grinder', ['grind', 'calley', 'caller']],
];

/** Map any nickname ("RockBot", "Shark") to a portrait; unknowns get a stranger, stable per name. */
export function castKeyOf(name: string): CastKey {
  const n = (name || '').toLowerCase();
  for (const [key, words] of ALIASES) if (words.some((w) => n.includes(w))) return key;
  let h = 0;
  for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? 'stranger' : 'newcomer';
}

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const F = { fill: 'var(--portrait-fill, transparent)', stroke: 'currentColor', strokeWidth: 2.2, strokeLinejoin: 'round' } as const;
const DOT = { fill: 'currentColor', stroke: 'none' } as const;

const suitShoulders = (
  <>
    <path {...F} d='M12 101 C14 82 28 74 50 73 C72 74 86 82 88 101' />
    <path {...S} d='M40 74 L50 92 L60 74' />
    <path {...S} d='M50 92 L50 101' />
  </>
);

function Art({ k }: { k: CastKey }) {
  switch (k) {
    case 'shark':
      return (
        <>
          {suitShoulders}
          <path {...S} d='M46 82 l4 5 l4 -5' />
          {/* wide shark head with a dorsal fin */}
          <path {...F} d='M28 50 C27 34 38 25 50 25 C63 25 73 34 72 50 C71 63 62 70 50 70 C38 70 29 63 28 50 Z' />
          <path {...F} d='M44 26 C47 14 55 8 62 6 C59 13 58 20 59 28' />
          <circle {...DOT} cx='39' cy='45' r='2.4' />
          <circle {...DOT} cx='61' cy='45' r='2.4' />
          <path {...S} d='M36 58 C43 63 57 63 64 58' />
          <path {...S} strokeWidth={1.6} d='M40 59.5 l2 3 l2 -2.6 l2 3 l2 -2.8 l2 3 l2 -2.8 l2 3 l2 -2.6 l2 2.6' />
          <path {...S} strokeWidth={1.6} d='M30 52 l4 -1 M30 56 l4 -1 M70 52 l-4 -1 M70 56 l-4 -1' />
        </>
      );
    case 'nit':
      return (
        <>
          <path {...F} d='M14 101 C15 84 28 76 50 75 C72 76 85 84 86 101' />
          <path {...S} d='M38 76 C40 84 60 84 62 76' />
          <path {...S} d='M38 80 C40 88 60 88 62 80' />
          <ellipse {...F} cx='50' cy='50' rx='15' ry='19' />
          {/* flat cap */}
          <path {...F} d='M33 42 C33 30 42 25 52 26 C62 27 68 33 67 41 Z' />
          <path {...F} d='M31 42 C40 38 58 38 74 43 C66 46 44 46 31 42 Z' />
          <path {...S} d='M41 50 l6 0 M54 50 l6 0' />
          <path {...S} d='M40 47 l8 -1 M53 46 l8 1' strokeWidth={2.6} />
          <path {...S} d='M44 61 l12 0' />
          <path {...S} strokeWidth={1.4} d='M50 52 l-1.5 5 l2.5 0' />
        </>
      );
    case 'bluffington':
      return (
        <>
          {suitShoulders}
          <path {...F} d='M42 77 l8 4 l-8 4 Z M58 77 l-8 4 l8 4 Z' />
          <ellipse {...F} cx='50' cy='52' rx='15' ry='18' />
          {/* top hat */}
          <path {...F} d='M37 36 L38 12 C45 10 55 10 62 12 L63 36 Z' />
          <path {...S} d='M38 30 L62 30' strokeWidth={3.5} />
          <path {...F} d='M28 37 C40 33 60 33 72 37 C60 40 40 40 28 37 Z' />
          <circle {...DOT} cx='43' cy='50' r='2' />
          <circle {...S} cx='57' cy='50' r='5.2' />
          <circle {...DOT} cx='57' cy='50' r='1.8' />
          <path {...S} strokeWidth={1.3} d='M62 52 C66 60 66 68 62 74' />
          {/* handlebar moustache */}
          <path {...S} d='M50 59 C46 56 40 57 37 61 C35 63 33 62 33 60 M50 59 C54 56 60 57 63 61 C65 63 67 62 67 60' />
          <path {...S} d='M46 65 C48 66 52 66 54 65' />
        </>
      );
    case 'fox':
      return (
        <>
          <path {...F} d='M14 101 C16 85 30 77 50 76 C70 77 84 85 86 101' />
          {/* scarf */}
          <path {...F} d='M34 76 C42 82 58 82 66 76 L66 82 C58 88 42 88 34 82 Z' />
          <path {...S} d='M60 84 L64 98' />
          {/* fox head: ears, cheeks, snout */}
          <path {...F} d='M30 20 L42 36 C46 34 54 34 58 36 L70 20 C74 32 74 44 70 52 C66 62 58 70 50 74 C42 70 34 62 30 52 C26 44 26 32 30 20 Z' />
          <path {...S} strokeWidth={1.5} d='M33 27 L39 35 M67 27 L61 35' />
          <path {...S} d='M37 47 C40 44 44 44 46 47 M54 47 C56 44 60 44 63 47' />
          <path {...S} strokeWidth={1.5} d='M30 52 C38 56 44 58 50 66 C56 58 62 56 70 52' />
          <path {...DOT} d='M47 66 L53 66 L50 70 Z' />
          <path {...S} strokeWidth={1.6} d='M50 70 C48 72 46 72 45 71' />
        </>
      );
    case 'owl':
      return (
        <>
          <path {...F} d='M16 101 C17 84 30 74 50 73 C70 74 83 84 84 101' />
          <path {...F} d='M43 76 l7 4 l-7 4 Z M57 76 l-7 4 l7 4 Z' />
          <path {...F} d='M28 30 C26 22 30 18 34 16 C36 22 40 25 44 26 C48 25 52 25 56 26 C60 25 64 22 66 16 C70 18 74 22 72 30 C76 40 76 56 70 64 C64 72 36 72 30 64 C24 56 24 40 28 30 Z' />
          {/* spectacles */}
          <circle {...S} cx='40' cy='44' r='8.5' />
          <circle {...S} cx='60' cy='44' r='8.5' />
          <path {...S} d='M48.5 44 C49.5 42.5 50.5 42.5 51.5 44' />
          <circle {...DOT} cx='41' cy='45' r='2.8' />
          <circle {...DOT} cx='59' cy='45' r='2.8' />
          <path {...F} d='M47 52 L53 52 L50 59 Z' />
          <path {...S} strokeWidth={1.4} d='M38 62 l2 2 l2 -2 M48 64 l2 2 l2 -2 M58 62 l2 2 l2 -2' />
        </>
      );
    case 'grinder':
      return (
        <>
          {/* hoodie */}
          <path {...F} d='M12 101 C13 82 24 72 34 68 C28 60 26 48 30 38 C34 26 44 20 50 20 C56 20 66 26 70 38 C74 48 72 60 66 68 C76 72 87 82 88 101 Z' />
          <path {...S} d='M44 82 L44 96 M56 82 L56 96' />
          <ellipse {...F} cx='50' cy='50' rx='13' ry='16' />
          {/* headphones */}
          <path {...S} strokeWidth={3} d='M33 46 C33 30 67 30 67 46' />
          <rect {...F} x='29' y='43' width='7' height='12' rx='3' />
          <rect {...F} x='64' y='43' width='7' height='12' rx='3' />
          {/* tired eyes */}
          <path {...S} d='M42 48 l5 0 M53 48 l5 0' />
          <path {...S} strokeWidth={1.2} d='M42 52 C44 53.5 46 53.5 47 52 M53 52 C54 53.5 56 53.5 58 52' />
          <path {...S} d='M46 59 C48 58 52 58 54 59' />
        </>
      );
    case 'newcomer':
      return (
        <>
          <path {...F} d='M14 101 C15 84 28 76 50 75 C72 76 85 84 86 101' />
          <path {...S} d='M50 75 L50 101' />
          <ellipse {...F} cx='50' cy='50' rx='14' ry='18' />
          {/* beanie */}
          <path {...F} d='M35 44 C34 30 42 24 50 24 C58 24 66 30 65 44 Z' />
          <path {...F} d='M34 44 L66 44 L66 39 L34 39 Z' />
          <circle {...F} cx='50' cy='21' r='3.5' />
          <circle {...DOT} cx='44' cy='51' r='1.9' />
          <circle {...DOT} cx='56' cy='51' r='1.9' />
          <path {...S} d='M45 60 C48 62 52 62 55 60' />
        </>
      );
    case 'stranger':
    default:
      return (
        <>
          {suitShoulders}
          <ellipse {...F} cx='50' cy='52' rx='14' ry='18' />
          {/* fedora, face in shadow */}
          <path {...F} d='M36 38 C36 26 42 20 50 22 C58 20 64 26 64 38 Z' />
          <path {...S} d='M44 24 C47 27 53 27 56 24' />
          <path {...F} d='M24 40 C36 34 64 34 76 40 C64 44 36 44 24 40 Z' />
          <path {...S} strokeWidth={3} d='M37 37 L63 37' />
          <path fill='currentColor' opacity={0.28} d='M37 42 C42 46 58 46 63 42 L63 52 C56 55 44 55 37 52 Z' />
          <circle {...DOT} cx='44' cy='49' r='1.6' />
          <circle {...DOT} cx='56' cy='49' r='1.6' />
          <path {...S} d='M46 61 l8 0' />
        </>
      );
  }
}

export function Portrait({
  name,
  castKey,
  className,
  title,
}: {
  name?: string;
  castKey?: CastKey;
  className?: string;
  /** Accessible label; omit for decorative use. */
  title?: string;
}) {
  const id = React.useId().replace(/:/g, '');
  const k = castKey ?? castKeyOf(name ?? '');
  return (
    <svg
      viewBox='0 0 100 100'
      className={cn('block', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <filter id={`ink-${id}`} x='-5%' y='-5%' width='110%' height='110%'>
          <feTurbulence type='fractalNoise' baseFrequency='0.045' numOctaves='2' seed={k.length * 7} />
          <feDisplacementMap in='SourceGraphic' scale='2.4' />
        </filter>
      </defs>
      <g filter={`url(#ink-${id})`}>
        <Art k={k} />
      </g>
    </svg>
  );
}
