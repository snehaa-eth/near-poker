await import('./src/env.js');

/**
 * @param {boolean} isServer
 * @param {{ experiments: any; module: { rules: { test: RegExp; type: string; }[]; }; output: { webassemblyModuleFilename: string; }; resolve: { fallback?: Record<string, boolean>; alias?: Record<string, unknown> }; externals: any }} config
 */
function patchWasmModuleImport(isServer, config) {
  config.experiments = Object.assign(config.experiments || {}, {
    asyncWebAssembly: true,
  });

  config.module.rules.push({
    test: /\.wasm$/,
    type: 'webassembly/async',
  });

  if (isServer) {
    config.output.webassemblyModuleFilename =
      './../static/wasm/[modulehash].wasm';
  } else {
    config.output.webassemblyModuleFilename = 'static/wasm/[modulehash].wasm';
  }
}

/** @type {import("next").NextConfig} */
const config = {
  // Lets a production build run alongside `next dev` (NEXT_DIST_DIR=.next-build).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Lint runs separately (`pnpm lint`); don't block production builds on style rules.
  eslint: { ignoreDuringBuilds: true },
  // Agents play, people watch: legacy human-poker pages are gone. Operator
  // pages (/admin, /dev) stay off in production unless ENABLE_OPERATOR_PAGES=1.
  async redirects() {
    const operatorOn =
      process.env.NODE_ENV !== 'production' || process.env.ENABLE_OPERATOR_PAGES === '1';
    return [
      { source: '/game', destination: '/arena', permanent: false },
      { source: '/profile', destination: '/agents', permanent: false },
      ...(operatorOn
        ? []
        : [
            { source: '/admin', destination: '/arena', permanent: false },
            { source: '/dev/:path*', destination: '/arena', permanent: false },
          ]),
    ];
  },
  webpack: (config, { isServer }) => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    config.resolve.fallback = { fs: false, path: false, util: false };
    patchWasmModuleImport(isServer, config);
    return config;
  },
};

export default config;
