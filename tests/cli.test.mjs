import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { zipSync } from 'fflate';
const bin = fileURLToPath(new URL('../bin/gamehub.mjs', import.meta.url));
async function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { env: { ...process.env, GAMEHUB_TOKEN: '', ...env } });
    let out = '', err = '';
    child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
    child.on('error', reject); child.on('close', code => resolve({ code, out, err }));
  });
}
test('CLI is independently runnable and validates arguments without network', async () => {
  assert.equal((await run(['--help'])).code, 0);
  const bad = await run(['upload', '.', '--unknown', '--json']);
  assert.equal(bad.code, 1); assert.equal(JSON.parse(bad.out).ok, false);
  assert.equal((await run(['whoami', '--site', 'http://example.com', '--json'])).code, 1);
  const longTag = await run(['link', 'https://games.example/demo', '--title', 'Game', '--tags', '1234567890123', '--dry-run', '--site', 'https://game.example.com', '--json']);
  assert.equal(longTag.code, 1, 'tag length must match server maximum 12');
});
test('files: HTML, directory, ZIP, unsupported files, symlinks and traversal', async () => {
  const { collectFiles } = await import('../lib/files.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'gamehub-files-'));
  try {
    await writeFile(join(dir, 'index.html'), 'hello');
    await mkdir(join(dir, 'assets')); await writeFile(join(dir, 'assets/main.js'), 'alert(1)');
    const bundle = await collectFiles(dir);
    assert.equal(bundle.entry, 'index.html'); assert.equal(bundle.files.length, 2);
    assert.equal((await collectFiles(join(dir, 'index.html'))).files.length, 1);
    const archive = join(dir, 'package.zip');
    await writeFile(archive, zipSync({ 'index.html': new TextEncoder().encode('hello'), 'a.js': new Uint8Array([1]) }));
    assert.equal((await collectFiles(archive)).files.length, 2);
    await writeFile(archive, zipSync({ '../index.html': new Uint8Array([1]) }));
    await assert.rejects(collectFiles(archive), /path/i);
    await writeFile(archive, zipSync({ 'index.html': new Uint8Array([1]), 'bad.exe': new Uint8Array([1]) }));
    await assert.rejects(collectFiles(archive), /type/i);
    await rm(archive);
    await symlink(join(dir, 'assets'), join(dir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(collectFiles(dir), /symbolic/i);
    await rm(join(dir, 'linked'));
    await writeFile(join(dir, 'bad.exe'), 'x');
    await assert.rejects(collectFiles(dir), /type/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('ZIP rejects oversized declarations and corrupted archives before decompression', async () => {
  const { collectFiles } = await import('../lib/files.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'gamehub-zip-'));
  try {
    const zip = zipSync({ 'index.html': new Uint8Array([1]) });
    const central = Buffer.from(zip).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    new DataView(zip.buffer).setUint32(central + 24, 200 * 1024 * 1024, true);
    const path = join(dir, 'bomb.zip'); await writeFile(path, zip);
    await assert.rejects(collectFiles(path), /size|large|limit/i);
    await writeFile(path, 'not a zip'); await assert.rejects(collectFiles(path), /ZIP/i);
    const actualMismatch = zipSync({ 'index.html': new Uint8Array(1000).fill(65) });
    const centralOffset = Buffer.from(actualMismatch).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    new DataView(actualMismatch.buffer).setUint32(centralOffset + 24, 1, true);
    await writeFile(path, actualMismatch);
    await assert.rejects(collectFiles(path), /size/i);
    const pathMismatch = zipSync({ 'index.html': new Uint8Array([1]) });
    pathMismatch[30] = 'x'.charCodeAt(0); // Local name differs from central name.
    await writeFile(path, pathMismatch);
    await assert.rejects(collectFiles(path), /path/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('creation is never retried, finalize failures retain upload ID without cancel, and redirects are rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gamehub-failure-'));
  const file = join(dir, 'index.html'); await writeFile(file, 'hello');
  let mode = 'init'; const calls = [];
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    calls.push(req.url); res.setHeader('Content-Type', 'application/json');
    if (mode === 'redirect') { res.statusCode = 302; res.setHeader('Location', '/stolen'); return res.end('{}'); }
    if (req.url === '/api/upload/init' && mode === 'finalize') return res.end(JSON.stringify({ id: 'upload12', gameId: 'game1234' }));
    if (req.url === '/api/upload/put') return res.end('{"ok":true}');
    res.statusCode = 503; res.end('{"error":"temporarily unavailable"}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = `http://127.0.0.1:${server.address().port}`;
  const common = ['--site', site, '--title', 'Game', '--json'];
  const env = { GAMEHUB_TOKEN: 'ghu_' + 'b'.repeat(43), GAMEHUB_CONFIG_DIR: join(dir, 'config') };
  try {
    assert.equal((await run(['upload', file, ...common], env)).code, 1);
    assert.equal(calls.filter(p => p === '/api/upload/init').length, 1);
    calls.length = 0;
    assert.equal((await run(['upload', file, '--guest', ...common], env)).code, 1);
    assert.deepEqual(calls, [], 'file guest mode is rejected before network writes');
    calls.length = 0; mode = 'finalize';
    const result = await run(['upload', file, ...common], env);
    assert.equal(result.code, 1); assert.equal(JSON.parse(result.out).uploadId, 'upload12');
    assert.equal(calls.filter(p => p === '/api/upload/finalize').length, 3);
    assert.ok(!calls.includes('/api/upload/cancel'));
    calls.length = 0; mode = 'redirect';
    assert.equal((await run(['whoami', '--site', site, '--json'], env)).code, 1);
    assert.deepEqual(calls, ['/api/auth/me']);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
test('actual CLI commands: login saves private credentials; upload/update/link, retries and logout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gamehub-cli-'));
  const config = join(dir, 'config');
  const file = join(dir, 'index.html'); await writeFile(file, 'hello');
  const calls = []; let puts = 0;
  const tokenId = '11111111-1111-4111-8111-111111111111';
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString(); calls.push({ path: req.url, method: req.method, body });
    assert.equal(req.headers.origin, site);
    res.setHeader('Content-Type', 'application/json');
    const send = value => res.end(JSON.stringify(value));
    if (req.url === '/api/auth/cli/device') return send({ deviceCode: 'd'.repeat(43), userCode: 'code12345678', verificationUri: site + '/verify', expiresIn: 10, interval: 0.01 });
    if (req.url === '/api/auth/cli/poll') return send({ status: 'authorized', token: 'ghu_' + 'a'.repeat(43), tokenId, expiresAt: Date.now() + 86400000 });
    if (req.url === '/api/auth/me') return send({ user: { id: 'u1', login: 'creator' }, banned: false });
    if (req.url === '/api/upload/init' || req.url === '/api/upload/link') return send({ id: 'upload12', gameId: 'game1234', paths: ['index.html'] });
    if (req.url === '/api/upload/put') {
      assert.equal(req.headers.authorization, 'Bearer ghu_' + 'a'.repeat(43));
      assert.equal(body, 'hello');
      if (++puts === 1) { res.statusCode = 503; return send({ error: 'temporary' }); }
      return send({ ok: true });
    }
    if (req.url === '/api/upload/finalize') return send({ ok: true, id: 'game1234', slug: 'game1234' });
    if (req.url === '/api/games/game1234') return send({ game: { id: 'game1234', status: 'pending' } });
    if (req.method === 'DELETE' && req.url === '/api/auth/cli/tokens/' + tokenId) return send({ ok: true });
    res.statusCode = 404; send({ error: 'missing' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = `http://127.0.0.1:${server.address().port}`;
  const args = ['--site', site, '--json']; const env = { GAMEHUB_CONFIG_DIR: config };
  try {
    const login = await run(['login', '--no-browser', ...args], env);
    assert.equal(login.code, 0, login.err + login.out); assert.equal(JSON.parse(login.out).user.login, 'creator');
    assert.match(login.err, /\/verify/); assert.ok(!login.out.includes('ghu_'));
    const credentialFile = join(config, `site-${createHash('sha256').update(site).digest('hex')}.json`);
    if (process.platform !== 'win32') {
      assert.equal((await stat(credentialFile)).mode & 0o777, 0o600);
      assert.equal((await stat(config)).mode & 0o777, 0o700);
    }
    assert.equal((await run(['whoami', ...args], env)).code, 0);
    const dry = await run(['upload', file, '--title', 'Game', '--dry-run', ...args], env);
    assert.equal(dry.code, 0, dry.out); assert.equal(calls.filter(c => c.path === '/api/upload/init').length, 0);
    const uploaded = await run(['upload', file, '--title', 'Game', ...args], env);
    assert.equal(uploaded.code, 0, uploaded.err + uploaded.out);
    assert.equal(JSON.parse(uploaded.out).shareUrl, site + '/zh/g/game1234');
    assert.equal(JSON.parse(uploaded.out).status, 'pending'); assert.equal(puts, 2);
    assert.equal((await run(['upload', file, '--title', 'Game', '--game-id', 'game1234', ...args], env)).code, 1);
    assert.equal((await run(['upload', file, '--title', 'Game', '--game-id', 'game1234', '--version-note', 'fix', ...args], env)).code, 0);
    assert.equal(JSON.parse(calls.filter(c => c.path === '/api/upload/init').at(-1).body).versionNote, 'fix');
    assert.equal((await run(['link', 'https://games.example/demo', '--title', 'Link', ...args], env)).code, 0);
    assert.equal((await run(['logout', ...args], env)).code, 0);
    assert.ok(!(await readFile(credentialFile, 'utf8')).includes('ghu_'));
    assert.equal((await run(['whoami', ...args], env)).code, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
