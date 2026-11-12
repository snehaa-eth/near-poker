import type { Config } from 'tailwindcss';

/**
 * Dark Table theme: see ui-audit/DESIGN-SYSTEM.md (§9 Tailwind mapping).
 * Semantic tokens live as CSS variables in src/styles/globals.css.
 * Legacy shadcn names (background, foreground, muted, card, primary…) are kept
 * as aliases that resolve to the dark tokens.
 */
const config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx,md,mdx}',
    './components/**/*.{ts,tsx,md,mdx}',
    './app/**/*.{ts,tsx,md,mdx}',
    './src/**/*.{ts,tsx,md,mdx}',
  ],
  prefix: '',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        sans: [
          'var(--font-sans)',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
        /** Big Shoulders Display (700–900): logo, headlines, pot, big numbers. */
        display: ['var(--font-display)', 'Impact', 'sans-serif'],
        /** Legacy alias: the old poker face now resolves to the display face. */
        poker: ['var(--font-display)', 'Impact', 'sans-serif'],
      },
      colors: {
        bg: 'var(--bg)',
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        border: { DEFAULT: 'var(--border)', strong: 'var(--border-strong)' },
        fg: {
          DEFAULT: 'var(--text)',
          muted: 'var(--text-muted)',
          subtle: 'var(--text-subtle)',
          disabled: 'var(--text-disabled)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          ink: 'var(--accent-ink)',
          soft: 'var(--accent-soft)',
          hover: 'var(--accent-hover)',
          foreground: 'var(--accent-ink)',
        },
        felt: { 1: 'var(--felt-1)', 2: 'var(--felt-2)' },
        rail: 'var(--rail)',
        // Atmosphere only (never UI state): lamp light, receipt paper, ink, rubber stamps.
        lamp: 'var(--lamp)',
        paper: { DEFAULT: 'var(--paper)', shade: 'var(--paper-shade)' },
        ink: { DEFAULT: 'var(--ink)', muted: 'var(--ink-muted)' },
        stamp: { DEFAULT: 'var(--stamp)', red: 'var(--stamp-red)' },
        ivory: { DEFAULT: 'var(--ivory)', hover: 'var(--ivory-hover)' },
        brass: 'var(--brass)',
        'card-red': 'var(--card-red)',
        positive: 'var(--positive)',
        negative: 'var(--negative)',
        warning: 'var(--warning)',
        info: 'var(--info)',
        live: 'var(--live)',
        gold: 'var(--gold)',
        silver: 'var(--silver)',
        bronze: 'var(--bronze)',
        // Legacy shadcn aliases
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
      },
      fontSize: {
        label: [
          '11px',
          { lineHeight: '16px', letterSpacing: '0.08em', fontWeight: '600' },
        ],
        caption: ['13px', '18px'],
        body: ['15px', '24px'],
        lead: ['17px', '26px'],
        h3: ['20px', { lineHeight: '28px', letterSpacing: '-0.01em' }],
        h2: ['28px', { lineHeight: '32px', letterSpacing: '0.02em' }],
        h1: ['40px', { lineHeight: '44px', letterSpacing: '0.01em' }],
        'h1-sm': ['32px', { lineHeight: '36px', letterSpacing: '0.01em' }],
        hero: ['64px', '0.95'],
        pot: [
          '28px',
          { lineHeight: '32px', letterSpacing: '-0.02em', fontWeight: '700' },
        ],
        stack: ['15px', { lineHeight: '20px', fontWeight: '600' }],
        countdown: [
          '40px',
          { lineHeight: '44px', letterSpacing: '-0.02em', fontWeight: '600' },
        ],
      },
      borderRadius: {
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
      },
      boxShadow: {
        e2: 'var(--shadow-e2)',
        e3: 'var(--shadow-e3)',
        glow: 'var(--glow-accent)',
      },
      maxWidth: {
        container: 'var(--container)',
        narrow: 'var(--container-narrow)',
      },
      spacing: { nav: 'var(--nav-h)' },
      transitionDuration: {
        instant: '100ms',
        fast: '150ms',
        base: '200ms',
        move: '350ms',
        emph: '600ms',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(.2,0,0,1)',
        move: 'cubic-bezier(.3,0,0,1)',
        emph: 'cubic-bezier(.16,1,.3,1)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;

export default config;
