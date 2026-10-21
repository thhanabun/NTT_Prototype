import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', ...(args.length ? args : ['-p', '3001'])], {
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, NEXT_PUBLIC_ENABLE_MOCK_AUTH: 'true' },
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
