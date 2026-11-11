export const SOUNDS = {
  bet: '/sounds/Bet.mp3',
  cashout: '/sounds/Cashout.mp3',
  paajiCashOut: '/sounds/PaajiCashOut.mp3',
  paajiWin: '/sounds/PaajiWin.mp3',
  paajiLose: '/sounds/PaajiLose.mp3',
  bomb: '/sounds/Bomb.mp3',
  gems: '/sounds/Gems.mp3',
} as const;

export type SoundName = keyof typeof SOUNDS;

const cache = new Map<SoundName, HTMLAudioElement>();

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

/** Play a named SFX from `/public/sounds`. Safe to call from clicks. */
export function playSound(name: SoundName, volume = 0.7) {
  try {
    const base = getAudio(name);
    if (!base) return;
    // Clone so overlapping clicks don't cut each other off
    const audio = base.cloneNode(true) as HTMLAudioElement;
    audio.volume = Math.min(1, Math.max(0, volume));
    void audio.play().catch(() => {
      // Autoplay policies / missing file — ignore
    });
  } catch {
    // ignore
  }
}

/** Prefetch common button sounds. */
export function preloadSounds(names: SoundName[] = ['gems', 'cashout', 'bet']) {
  for (const name of names) {
    getAudio(name);
  }
}
