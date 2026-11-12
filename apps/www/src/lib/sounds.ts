/**
 * Poker SFX from `/public/audio-effect` (Pepper pack).
 * URL-safe copies sit next to the original filenames in that folder.
 */
export const SOUNDS = {
  /** Hole / board deal */
  cardDeal: '/audio-effect/deal.mp3',
  /** Soft flip — check, fold, UI tick */
  cardFlip: '/audio-effect/chat-soft.mp3',
  /** Chips into the pot — call / bet / raise */
  chipsBet: '/audio-effect/chips.mp3',
  /** Bigger chip movement — all-in, pot award */
  chipsShuffle: '/audio-effect/chips.mp3',
  /** Deck shuffle / new hand */
  shuffle: '/audio-effect/shuffle.mp3',
  /** Accent / chat ping */
  pepperChat: '/audio-effect/chat.mp3',
  /** Hand win */
  win: '/audio-effect/win.mp3',

  // Legacy aliases → audio-effect pack
  bet: '/audio-effect/chips.mp3',
  gems: '/audio-effect/chat-soft.mp3',
  bomb: '/audio-effect/shuffle.mp3',
  cashout: '/audio-effect/chips.mp3',
  paajiCashOut: '/audio-effect/chips.mp3',
  paajiWin: '/audio-effect/win.mp3',
  paajiLose: '/audio-effect/chat-soft.mp3',
} as const;

export type SoundName = keyof typeof SOUNDS;

const MUTE_KEY = 'dark-table:sfx-muted';

const cache = new Map<SoundName, HTMLAudioElement>();
const listeners = new Set<(muted: boolean) => void>();

let muted = false;

function readStoredMute(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStoredMute(next: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function notify() {
  for (const fn of listeners) fn(muted);
}

/** Current mute flag (SSR-safe; false until hydrated). */
export function isSoundMuted() {
  return muted;
}

/** Subscribe to mute changes. Returns unsubscribe. */
export function subscribeSoundMute(fn: (muted: boolean) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Hydrate mute from localStorage (call once on the client). */
export function hydrateSoundMute() {
  muted = readStoredMute();
  notify();
  return muted;
}

export function setSoundMuted(next: boolean) {
  muted = next;
  writeStoredMute(next);
  notify();
}

export function toggleSoundMuted() {
  setSoundMuted(!muted);
  return muted;
}

function getAudio(name: SoundName): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  let audio = cache.get(name);
  if (!audio) {
    audio = new Audio(SOUNDS[name]);
    audio.preload = 'auto';
    cache.set(name, audio);
  }
  return audio;
}

/** Play a named SFX. Safe to call from clicks / view updates. No-ops when muted. */
export function playSound(name: SoundName, volume = 0.7) {
  if (muted) return;
  try {
    const base = getAudio(name);
    if (!base) return;
    // Clone so overlapping plays don't cut each other off
    const audio = base.cloneNode(true) as HTMLAudioElement;
    audio.volume = Math.min(1, Math.max(0, volume));
    void audio.play().catch(() => {
      // Autoplay policies / missing file — ignore
    });
  } catch {
    // ignore
  }
}

/** Prefetch common table sounds. */
export function preloadSounds(
  names: SoundName[] = [
    'cardDeal',
    'cardFlip',
    'chipsBet',
    'chipsShuffle',
    'shuffle',
    'pepperChat',
    'win',
  ]
) {
  for (const name of names) {
    getAudio(name);
  }
}
