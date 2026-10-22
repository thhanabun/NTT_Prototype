import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

export async function startLocalApi({ corsOrigin, agentProvider = 'mock' } = {}) {
  const repository = fileURLToPath(new URL('../../../', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'basketly-admin-'));
  let server;
  let port = 0;
  async function stop() {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise(resolveExit => server.once('exit', resolveExit));
      server.kill();
      await exited;
    }
  }
  async function close() {
    await stop();
    assert.ok(directory.startsWith(join(tmpdir(), 'basketly-admin-')));
    await rm(directory, { recursive: true, force: true });
  }
  try {
    let source = await readFile(resolve(repository, 'src/server.mjs'), 'utf8');
    const replacements = [
      ...['store-repository.mjs', 'application.mjs', 'logger.mjs', 'presence.mjs', 'store-layout.mjs', 'positioning.mjs'].map(name => [
        `from "./${name}"`, `from ${JSON.stringify(pathToFileURL(resolve(repository, 'src', name)).href)}`,
      ]),
      ['const root = resolve(fileURLToPath(new URL("../public", import.meta.url)));', `const root = ${JSON.stringify(resolve(repository, 'public'))};`],
      ['const dataDir = resolve(root, "../data");', `const dataDir = ${JSON.stringify(directory)};`],
      ['console.log("Smart Basket prototype listening at http://" + host + ":" + port);', 'console.log("TEST_API_READY:" + server.address().port);'],
    ];
    for (const [before, after] of replacements) {
      assert.ok(source.includes(before), 'Local API test harness needs updating for the server layout');
      source = source.replace(before, after);
    }
    if (corsOrigin) {
      // Test-only CORS/diagnostics permit native EventSource to use this isolated server.
      source = source.replace('const subscribers = new Set();', 'const subscribers = new Set(); let invalidStream = false;');
      source = source.replace('JSON.stringify(application.getSnapshot())', '(invalidStream ? "invalid" : JSON.stringify(application.getSnapshot()))');
      source = source.replace('JSON.stringify(state)', '(invalidStream ? "invalid" : JSON.stringify(state))');
      source = source.replace('const server = createServer(async (request, response) => {', `const server = createServer(async (request, response) => {
        response.setHeader("Access-Control-Allow-Origin", ${JSON.stringify(corsOrigin)});
        if (request.url === "/__test/subscribers") return sendJson(response, 200, {count:subscribers.size});
        if (request.url === "/__test/invalid") { invalidStream = true; publish(); return sendJson(response,200,{ok:true}); }
        if (request.url === "/__test/valid") { invalidStream = false; return sendJson(response,200,{ok:true}); }
      `);
    }
    const file = join(directory, 'server.mjs');
    await writeFile(file, source);
    async function start() {
      server = spawn(process.execPath, [file], { env: { ...process.env, PORT:String(port), HOST:'127.0.0.1', STORE_BACKEND:'local', STORE_PATH:join(directory, 'state.json'), AGENT_PROVIDER:agentProvider }, stdio:['ignore','pipe','pipe'] });
      return new Promise((resolveReady, reject) => {
        const timer = setTimeout(() => reject(new Error('Test API startup timed out')), 15000);
        server.on('error', error => { clearTimeout(timer); reject(error); });
        server.on('exit', code => { clearTimeout(timer); reject(new Error(`Test API exited: ${code}`)); });
        server.stdout.on('data', chunk => {
          const actualPort = chunk.toString().match(/TEST_API_READY:(\d+)/)?.[1];
          if (actualPort) { port = Number(actualPort); clearTimeout(timer); resolveReady(`http://127.0.0.1:${port}`); }
        });
        server.stderr.on('data', chunk => process.stderr.write(chunk));
      });
    }
    const origin = await start();
    return {origin, directory, close, stop, restart:async () => {await stop(); await start();}};
  } catch (error) { await close(); throw error; }
}
