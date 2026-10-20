import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute } from '../lib/commands.mjs';

// Exercise the real command flow while controlling only the network boundary.
test('rejects malformed session/completion responses without following undefined IDs', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GAMEHUB_TOKEN;
  const dir = await mkdtemp(join(tmpdir(), 'ugcplay-response-'));
  const file = join(dir, 'index.html');
  await writeFile(file, 'Game');
  process.env.GAMEHUB_TOKEN = 'ghu_' + 'a'.repeat(43);
  try {
    for (const command of ['upload', 'link']) {
      for (const bad of [{}, { id: null }, { id: 'upload12' }, [], null, 'not-an-object', { ok: false }]) {
        const calls = [];
        globalThis.fetch = async url => {
          calls.push(new URL(url).pathname);
          return Response.json(bad);
        };
        await assert.rejects(execute(command, command === 'upload' ? file : 'https://games.example/demo', { title: 'Game' }, 'https://site.example'), /response/i);
        assert.deepEqual(calls, [command === 'upload' ? '/api/upload/init' : '/api/upload/link']);
      }
    }
    for (const bad of [{}, { id: 'game1234' }, { id: null, slug: 'game1234' }, { id: 'other123', slug: 'other123' }]) {
      const calls = [];
      globalThis.fetch = async url => {
        const path = new URL(url).pathname; calls.push(path);
        return Response.json(path === '/api/upload/link' ? { id: 'upload12', gameId: 'game1234' } : bad);
      };
      await assert.rejects(execute('link', 'https://games.example/demo', { title: 'Game' }, 'https://site.example'), error => {
        assert.equal(error.uploadId, 'upload12');
        assert.match(error.message, /response/i);
        return true;
      });
      assert.deepEqual(calls, ['/api/upload/link', '/api/upload/finalize']);
    }
    for (const command of ['upload', 'link']) {
      const calls = [];
      globalThis.fetch = async url => {
        const path = new URL(url).pathname; calls.push(path);
        return Response.json(path === '/api/upload/init' || path === '/api/upload/link'
          ? { id: 'upload12', gameId: 'other123' }
          : { id: 'other123', slug: 'other123' });
      };
      await assert.rejects(execute(command, command === 'upload' ? file : 'https://games.example/demo',
        { title: 'Game', 'game-id': 'game1234', 'version-note': 'Fix' }, 'https://site.example'), error => {
        assert.equal(error.uploadId, 'upload12');
        assert.match(error.message, /response/i);
        return true;
      });
      assert.deepEqual(calls, [command === 'upload' ? '/api/upload/init' : '/api/upload/link']);
    }
    for (const bad of [{}, { id: 'game1234', slug: 'game1234' }]) {
      globalThis.fetch = async () => Response.json(bad);
      await assert.rejects(execute('link', 'https://games.example/demo', { title: 'Game', guest: true }, 'https://site.example'), /response/i);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GAMEHUB_TOKEN; else process.env.GAMEHUB_TOKEN = originalToken;
    await rm(dir, { recursive: true, force: true });
  }
});
