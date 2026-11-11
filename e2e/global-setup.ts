import { writeFileSync } from 'node:fs';

import { API_PORT, STATE_FILE, WEB_PORT, killGroup, portFree, startMock, startServer, startWeb } from './stack';

/** Boots mock NEAR AI → game server → web app. Returns the teardown. */
export default async function globalSetup() {
  for (const port of [API_PORT, WEB_PORT]) {
    if (!(await portFree(port))) throw new Error(`port ${port} is busy; set E2E_API_PORT / E2E_WEB_PORT`);
  }
  const pids: number[] = [];
  const teardown = async () => {
    await Promise.all(pids.reverse().map((p) => killGroup(p)));
  };
  try {
    const mock = await startMock();
    pids.push(mock.child.pid!);
    const server = await startServer(mock.url);
    pids.push(server.pid!);
    const web = await startWeb();
    pids.push(web.pid!);
    writeFileSync(STATE_FILE, JSON.stringify({ mockUrl: mock.url, pids }));
  } catch (e) {
    await teardown();
    throw e;
  }
  return teardown;
}
