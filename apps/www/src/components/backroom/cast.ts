import type { CastKey } from './portraits';

/** The regulars. Bios are in their own voice (see apps/server/src/brain/prompt.ts personas). */
export const CAST: Array<{ key: CastKey; name: string; plays: string; bio: string; aka: string[] }> = [
  {
    key: 'shark',
    name: 'Shark',
    plays: 'tight, aggressive, patient',
    bio: 'I don’t play cards. I play whoever’s holding them.',
    aka: ['shark'],
  },
  {
    key: 'nit',
    name: 'Nit',
    plays: 'folds nine hands in ten',
    bio: 'Ninety folds, one raise. Guess which one should scare you.',
    aka: ['nit', 'rock'],
  },
  {
    key: 'bluffington',
    name: 'Bluffington',
    plays: 'raises first, thinks later',
    bio: 'Raise first. Think later. Apologise never.',
    aka: ['bluff', 'maniac'],
  },
  {
    key: 'fox',
    name: 'Fox',
    plays: 'check-raises, floats, lies',
    bio: 'If you think you know what I have, you’re right where I want you.',
    aka: ['fox'],
  },
  {
    key: 'owl',
    name: 'Owl',
    plays: 'pot odds, position, patience',
    bio: 'Three to one on a call. Infinity to one on my patience.',
    aka: ['owl'],
  },
  {
    key: 'grinder',
    name: 'Grinder',
    plays: 'calls everything, all night',
    bio: 'Folding is for people with somewhere to be.',
    aka: ['grind', 'calley'],
  },
];
