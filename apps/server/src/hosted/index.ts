/** Hosted agents: wire-up for app.ts. */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { resumeHostedAgents } from './routes.js';
import { setGamePort } from './runner.js';
import { setStatsPort } from './stats.js';

export { hostedRouter } from './routes.js';

/** Learn the listening port (agents connect to http://localhost:<port>) and resume agents. */
export function attachHosted(server: Server, opts: { resume?: boolean } = {}) {
  server.on('listening', () => {
    const port = (server.address() as AddressInfo | null)?.port;
    if (!port) return;
    setGamePort(port);
    setStatsPort(port);
    if (opts.resume ?? process.env.HOSTED_RESUME !== '0') {
      setTimeout(() => {
        resumeHostedAgents().catch((e) => console.warn('[hosted] resume failed:', (e as Error).message));
      }, 3000).unref();
    }
  });
}
