import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { zipSync } from 'fflate';

const bin = fileURLToPath(new URL('../bin/gamehub.mjs', import.meta.url));
function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => stdout += b);
    child.stderr.on('data', b => stderr += b);
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('all submission channels send the same prepared summary and tags as dry-run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ugcplay-meta-'));
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    let body;
    if (req.headers['content-type']?.startsWith('application/json')) body = JSON.parse(raw);
    calls.push({ path: req.url, body });
    res.setHeader('Content-Type', 'application/json');
    const send = value => res.end(JSON.stringify(value));
    if (req.url === '/api/upload/link' && body.guest) return send({ id: 'game1234', slug: 'game1234', claimToken: 'test-private-claim' });
    if (req.url === '/api/upload/init' || req.url === '/api/upload/link') return send({ id: 'upload12', gameId: 'game1234' });
    if (req.url === '/api/upload/finalize') return send({ id: 'game1234', slug: 'game1234' });
    if (req.url === '/api/upload/put') return send({ ok: true });
    if (req.url === '/api/games/game1234') return send({ game: { status: 'pending' } });
    res.statusCode = 404;
    send({ error: 'Unexpected request' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = `http://127.0.0.1:${server.address().port}`;
  const env = { GAMEHUB_TOKEN: 'ghu_' + 'a'.repeat(43), GAMEHUB_CONFIG_DIR: join(dir, 'credentials') };
  const title = '小猫跳跳';
  const summary = '控制小猫跳过障碍，收集金币并争取更高分。';
  const tags = ['平台跳跃', '休闲'];
  const common = ['--site', site, '--title', title, '--summary', summary, '--tags', tags.join(','), '--json'];
  try {
    const html = '<title>小猫跳跳</title><h1>跳过障碍，收集金币</h1>';
    const file = join(dir, 'game.html');
    const build = join(dir, 'dist');
    const zip = join(dir, 'game.zip');
    await writeFile(file, html);
    await mkdir(build);
    await writeFile(join(build, 'index.html'), html);
    await writeFile(zip, zipSync({ 'index.html': new TextEncoder().encode(html) }));
    const cases = [
      { args: ['upload', file], path: '/api/upload/init' },
      { args: ['upload', build], path: '/api/upload/init' },
      { args: ['upload', zip], path: '/api/upload/init' },
      { args: ['upload', build, '--game-id', 'game1234', '--version-note', '改善跳跃手感'], path: '/api/upload/init', update: true },
      { args: ['link', 'https://games.example/cat'], path: '/api/upload/link' },
      { args: ['link', 'https://games.example/cat', '--mirror'], path: '/api/upload/link' },
      { args: ['link', 'https://games.example/cat', '--guest'], path: '/api/upload/link' },
    ];
    for (const scenario of cases) {
      calls.length = 0;
      const dry = await run([...scenario.args, ...common, '--dry-run'], env);
      assert.equal(dry.code, 0, dry.stdout + dry.stderr);
      assert.equal(calls.length, 0, 'dry-run must not contact the server');
      const plan = JSON.parse(dry.stdout);
      assert.equal(plan.summary, summary);
      assert.deepEqual(plan.tags, tags);
      const result = await run([...scenario.args, ...common], env);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.equal(JSON.parse(result.stdout).status, 'pending');
      const sent = calls.find(call => call.path === scenario.path)?.body;
      assert.ok(sent, scenario.args.join(' '));
      assert.equal(sent.title, plan.title);
      assert.equal(sent.summary, plan.summary);
      assert.deepEqual(sent.tags, plan.tags);
      if (scenario.update) {
        assert.equal(sent.gameId, 'game1234');
        assert.equal(sent.versionNote, '改善跳跃手感');
      }
      if (scenario.args.includes('--mirror')) assert.equal(sent.mirror, true);
    }
    calls.length = 0;
    for (const override of [
      ['--summary', 'x'.repeat(501)],
      ['--tags', 'a,b,c,d'],
      ['--tags', 'x'.repeat(13)],
    ]) {
      const result = await run(['upload', file, ...common, ...override], env);
      assert.equal(result.code, 1, result.stdout);
      assert.match(JSON.parse(result.stdout).error, /Metadata exceeds/);
    }
    assert.equal(calls.length, 0, 'invalid metadata must fail before network writes');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
