import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

export async function startLocalApi() {
  const repository = fileURLToPath(new URL('../../../', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'basketly-admin-'));
  let server;
  async function close() {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise(resolveExit => server.once('exit', resolveExit));
      server.kill();
      await exited;
    }
    assert.ok(directory.startsWith(join(tmpdir(), 'basketly-admin-')));
    await rm(directory, { recursive: true, force: true });
  }
  try {
    let source = await readFile(resolve(repository, 'src/server.mjs'), 'utf8');
    const replacements = [
      ['from "./domain.mjs"', `from ${JSON.stringify(pathToFileURL(resolve(repository, 'src/domain.mjs')).href)}`],
      ['const root = resolve(fileURLToPath(new URL("../public", import.meta.url)));', `const root = ${JSON.stringify(resolve(repository, 'public'))};`],
      ['const dataDir = resolve(root, "../data");', `const dataDir = ${JSON.stringify(directory)};`],
      ['console.log("Smart Basket prototype listening at http://" + host + ":" + port);', 'console.log("TEST_API_READY:" + server.address().port);'],
    ];
    for (const [before, after] of replacements) {
      assert.ok(source.includes(before), 'Local API test harness needs updating for the server layout');
      source = source.replace(before, after);
    }
    const file = join(directory, 'server.mjs');
    await writeFile(file, source);
    server = spawn(process.execPath, [file], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const origin = await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error('Test API startup timed out')), 15000);
      server.on('error', error => { clearTimeout(timer); reject(error); });
      server.on('exit', code => { clearTimeout(timer); reject(new Error(`Test API exited: ${code}`)); });
      server.stdout.on('data', chunk => {
        const port = chunk.toString().match(/TEST_API_READY:(\d+)/)?.[1];
        if (port) { clearTimeout(timer); resolveReady(`http://127.0.0.1:${port}`); }
      });
      server.stderr.on('data', chunk => process.stderr.write(chunk));
    });
    return { origin, directory, close };
  } catch (error) { await close(); throw error; }
}
