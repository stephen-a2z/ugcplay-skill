import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Copy just one network-free smoke case, rather than recursively running this test.
test('test runner can invoke the CLI from a checkout with spaces and Unicode in its path', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), 'ugcplay 中文 space '));
  try {
    for (const name of ['bin', 'lib']) await cp(join(root, name), join(dir, name), { recursive: true });
    await mkdir(join(dir, 'tests'));
    await cp(join(root, 'tests', 'cli.test.mjs'), join(dir, 'tests', 'cli.test.mjs'));
    // In an installed package, dependencies may be hoisted: resolve the fflate package root.
    const fflateRoot = fileURLToPath(new URL('../', import.meta.resolve('fflate')));
    await mkdir(join(dir, 'node_modules'));
    await symlink(fflateRoot, join(dir, 'node_modules', 'fflate'), process.platform === 'win32' ? 'junction' : 'dir');
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-name-pattern', 'CLI is independently runnable', join(dir, 'tests', 'cli.test.mjs')], { cwd: dir, encoding: 'utf8', env });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /# pass 1\b/, 'the nested smoke test must actually run');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
