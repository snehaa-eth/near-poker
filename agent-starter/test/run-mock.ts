// Free local stand-in for NEAR AI Cloud (no real API calls). Prints its base URL.
import { writeFileSync } from 'node:fs';
import { startMockNearAi } from './mock-nearai.ts';
const m = await startMockNearAi();
writeFileSync(process.argv[2]!, m.baseUrl);
console.log('mock NEAR AI at', m.baseUrl, 'signer', m.signingAddress.slice(0, 16));
setInterval(() => console.log('completions so far', m.completions), 15000);
