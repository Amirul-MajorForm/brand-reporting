// Starts the fake TMR server and the real dashboard server (as a child
// process, exactly as Railway runs it) on free ports.
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import net from 'net';
import { startFakeTMR } from './fake-tmr.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PASSWORD = 'correct-horse-battery-staple';

const freePort = () => new Promise(resolve => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

export async function startStack(extraEnv = {}) {
  const fake = await startFakeTMR();
  const port = await freePort();
  const fakeBase = `http://127.0.0.1:${fake.port}`;
  const child = spawn(process.execPath, [join(ROOT, 'backend/server.js')], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      TMR_API_KEY: 'test-tmr-key',
      TMR_BASE_URL: `${fakeBase}/v1`,
      TMR_GAP_MS: '0',
      TMR_MAX_PER_MIN: '1000',
      GOALS_SHEET_PUB_URL: `${fakeBase}/sheet/pub`,
      COMMERCE_TREND_START: '2026-09-01',
      DASHBOARD_PASSWORD: PASSWORD,
      SESSION_SECRET: 'test-session-secret-0123456789abcdef',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', d => { logs += d; });
  child.stderr.on('data', d => { logs += d; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server did not start:\n${logs}`)), 15000);
    const check = () => { if (logs.includes('Server running')) { clearTimeout(t); resolve(); } else setTimeout(check, 50); };
    child.on('exit', code => reject(new Error(`server exited ${code}:\n${logs}`)));
    check();
  });
  const base = `http://127.0.0.1:${port}`;
  return {
    base, fakeBase, logs: () => logs,
    tmrRequests: async () => (await fetch(`${fakeBase}/__fake/requests`)).json(),
    failNext: (status, message, count = 1) => fetch(`${fakeBase}/__fake/fail`, { method: 'POST', body: JSON.stringify({ status, message, count }) }),
    stop: async () => { child.kill(); await new Promise(r => fake.server.close(r)); },
  };
}

export async function signIn(base) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}
