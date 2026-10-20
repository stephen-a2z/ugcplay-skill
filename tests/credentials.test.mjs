import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { saveCredential, readCredentials } from '../lib/credentials.mjs';

const credential = i => ({ token: 'dummy-' + i, tokenId: 'dummy-id-' + i, expiresAt: Date.now() + 60000 });
test('concurrent credential saves/deletions preserve other sites and legacy credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ugcplay-credentials-'));
  const previous = process.env.UGCPLAY_CONFIG_DIR;
  process.env.UGCPLAY_CONFIG_DIR = dir;
  try {
    await Promise.all(Array.from({ length: 12 }, (_, i) => saveCredential(`https://site${i}.example`, credential(i))));
    assert.equal(Object.keys(await readCredentials()).length, 12);
    // A separate process also writes independently; a process-local mutex is insufficient.
    const moduleUrl = new URL('../lib/credentials.mjs', import.meta.url).href;
    await Promise.all(Array.from({ length: 6 }, (_, i) => new Promise((resolve, reject) => {
      const code = `import {saveCredential} from ${JSON.stringify(moduleUrl)}; await saveCredential(${JSON.stringify(`https://child${i}.example`)},${JSON.stringify(credential(i))});`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, UGCPLAY_CONFIG_DIR: dir }, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; child.stderr.on('data', b => err += b);
      child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(err)));
    })));
    assert.equal(Object.keys(await readCredentials()).length, 18);
    await Promise.all([saveCredential('https://site0.example', null), saveCredential('https://new.example', credential('new'))]);
    const saved = await readCredentials();
    assert.ok(!saved['https://site0.example']);
    assert.equal(Object.keys(saved).length, 18);
    // Existing users retain old logins, while a new-format logout must suppress the legacy record.
    await writeFile(join(dir, 'credentials.json'), JSON.stringify({ 'https://legacy.example': credential('legacy'), 'https://site0.example': credential('old') }));
    assert.equal((await readCredentials())['https://legacy.example'].token, 'dummy-legacy');
    assert.ok(!(await readCredentials())['https://site0.example']);
    await saveCredential('https://legacy.example', null);
    assert.ok(!(await readCredentials())['https://legacy.example']);
    const entries = (await readdir(dir)).filter(name => /^site-.*\.json$/.test(name));
    assert.ok(entries.length >= 19);
    for (const name of entries) {
      const entry = JSON.parse(await readFile(join(dir, name), 'utf8'));
      assert.equal(typeof entry.site, 'string');
      if (process.platform !== 'win32') assert.equal((await stat(join(dir, name))).mode & 0o777, 0o600);
    }
  } finally {
    if (previous === undefined) delete process.env.UGCPLAY_CONFIG_DIR; else process.env.UGCPLAY_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
