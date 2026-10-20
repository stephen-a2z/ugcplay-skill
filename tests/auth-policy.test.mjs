import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { zipSync } from 'fflate';

const bin = fileURLToPath(new URL('../bin/ugcplay.mjs', import.meta.url));
function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { env: { ...process.env, UGCPLAY_TOKEN: '', ...env } });
    let out = '', err = '';
    child.stdout.on('data', b => out += b);
    child.stderr.on('data', b => err += b);
    child.on('error', reject);
    child.on('close', code => resolve({ code, out, err }));
  });
}

test('all file inputs require login, reject --guest, and allow local dry-run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ugcplay-file-auth-'));
  const args = ['--site', 'http://127.0.0.1:1', '--title', 'Game', '--json'];
  const env = { UGCPLAY_CONFIG_DIR: join(dir, 'config') };
  try {
    const file = join(dir, 'game.html');
    const archive = join(dir, 'game.zip');
    const build = join(dir, 'dist');
    await writeFile(file, '<title>Game</title>');
    await writeFile(archive, zipSync({ 'index.html': new TextEncoder().encode('Game') }));
    await mkdir(build); await writeFile(join(build, 'index.html'), 'Game');
    for (const input of [file, archive, build]) {
      const anonymous = await run(['upload', input, ...args], env);
      assert.equal(anonymous.code, 1);
      assert.match(JSON.parse(anonymous.out).error, /Not logged in/);
      const guest = await run(['upload', input, '--guest', ...args], { ...env, UGCPLAY_TOKEN: 'ghu_' + 'a'.repeat(43) });
      assert.equal(guest.code, 1);
      assert.match(JSON.parse(guest.out).error, /--guest is not supported by upload/);
      assert.equal((await run(['upload', input, '--dry-run', ...args], env)).code, 0);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('URLs work without login, preserve account attribution, and never retry as guest after auth failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ugcplay-url-auth-'));
  const calls = [];
  let rejectAccount = false;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    calls.push({ path: req.url, authorization: req.headers.authorization, body });
    res.setHeader('Content-Type', 'application/json');
    const send = value => res.end(JSON.stringify(value));
    if (req.url === '/api/upload/link') {
      if (rejectAccount && req.headers.authorization) { res.statusCode = 401; return send({ error: 'Credential revoked' }); }
      return send(body.guest ? { id: 'game1234', slug: 'game1234', claimToken: 'private-claim' } : { id: 'upload12', gameId: 'game1234' });
    }
    if (req.url === '/api/upload/finalize') return send({ id: 'game1234', slug: 'game1234' });
    if (req.url === '/api/games/game1234') return send({ game: { status: 'pending' } });
    res.statusCode = 404; send({ error: 'Unexpected request' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = `http://127.0.0.1:${server.address().port}`;
  const config = join(dir, 'config');
  const args = ['link', 'https://games.example/demo', '--site', site, '--title', 'Game', '--json'];
  const env = { UGCPLAY_CONFIG_DIR: config };
  const token = 'ghu_' + 'a'.repeat(43);
  try {
    for (const extra of [[], ['--mirror']]) {
      calls.length = 0;
      const result = await run([...args, ...extra], env);
      assert.equal(result.code, 0, result.out + result.err);
      assert.equal(JSON.parse(result.out).claimToken, 'private-claim');
      assert.equal(calls[0].body.guest, true);
      assert.equal(calls[0].authorization, undefined);
      assert.equal(calls[0].body.mirror, extra.includes('--mirror'));
      assert.ok(!calls.some(call => call.path === '/api/upload/finalize'));
    }
    calls.length = 0;
    const dry = await run([...args, '--dry-run'], env);
    assert.equal(dry.code, 0); assert.equal(JSON.parse(dry.out).guest, true);
    assert.equal(calls.length, 0);
    const updateDry = await run([...args, '--game-id', 'game1234', '--version-note', 'fix', '--dry-run'], env);
    assert.equal(updateDry.code, 0, updateDry.out);
    assert.equal(JSON.parse(updateDry.out).guest, false);
    assert.equal(calls.length, 0);
    const update = await run([...args, '--game-id', 'game1234', '--version-note', 'fix'], env);
    assert.equal(update.code, 1); assert.match(JSON.parse(update.out).error, /login|logged in/i);
    assert.equal(calls.length, 0);
    await mkdir(config);
    for (const expiresAt of [Date.now() - 1000, Date.now() + 86400000]) {
      await writeFile(join(config, 'credentials.json'), JSON.stringify({ [site]: { token, expiresAt } }));
      calls.length = 0;
      const result = await run(args, env);
      assert.equal(result.code, 0, result.out + result.err);
      const guest = expiresAt <= Date.now();
      assert.equal(calls[0].body.guest, guest);
      assert.equal(calls[0].authorization, guest ? undefined : 'Bearer ' + token);
      assert.equal(calls.some(call => call.path === '/api/upload/finalize'), !guest);
    }
    for (const extra of [[], ['--guest']]) {
      calls.length = 0;
      const result = await run([...args, ...extra], { ...env, UGCPLAY_TOKEN: token });
      assert.equal(result.code, 0, result.out + result.err);
      assert.equal(calls[0].body.guest, extra.includes('--guest'));
    }
    calls.length = 0; rejectAccount = true;
    const rejected = await run(args, { ...env, UGCPLAY_TOKEN: token });
    assert.equal(rejected.code, 1); assert.equal(JSON.parse(rejected.out).status, 401);
    assert.deepEqual(calls.map(call => call.path), ['/api/upload/link']);
    assert.equal(calls[0].body.guest, false);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
