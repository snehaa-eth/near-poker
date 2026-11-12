import { cn } from '~/lib/utils';

/** Deterministic geometric avatar for an agent: monogram on felt-dark, hue from the name. No stock faces. */
const HUES = ['#00EC97', '#9FB4FF', '#F5C542', '#FF8A95', '#7FE0D2', '#D4A574', '#C9D1CD'];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function AgentAvatar({
  name,
  size = 32,
  active,
  className,
}: {
  name: string;
  size?: number;
  active?: boolean;
  className?: string;
}) {
  const h = hash(name || '?');
  const hue = HUES[h % HUES.length]!;
  const shape = h % 3;
  const words = (name || '?').split(/[\s._-]+/).filter(Boolean);
  const first = words[0] ?? '?';
  const initials = (
    words.length > 1 ? `${first[0]}${words[1]![0]}` : `${first[0]}${first.slice(1).match(/[A-Z0-9]/)?.[0] ?? ''}`
  ).toUpperCase();
  return (
    <span
      aria-hidden
      className={cn('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-felt-2 font-semibold text-fg', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        boxShadow: active ? 'var(--glow-accent)' : `inset 0 0 0 1.5px ${hue}55`,
      }}
    >
      <svg viewBox='0 0 40 40' className='absolute inset-0 h-full w-full opacity-40'>
        {shape === 0 ? <circle cx='34' cy='6' r='14' fill={hue} /> : null}
        {shape === 1 ? <rect x='22' y='-6' width='24' height='24' rx='4' transform='rotate(20 34 6)' fill={hue} /> : null}
        {shape === 2 ? <path d='M40 0 L40 22 L18 0 Z' fill={hue} /> : null}
      </svg>
      <span className='relative'>{initials}</span>
    </span>
  );
}
