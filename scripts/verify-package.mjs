import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, cp, readFile, readdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'ugcplay package 中文 '));
// npm run provides the actual npm JS entrypoint on every platform; avoid spawning .cmd files.
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run this verifier with npm run test:package');
const npm = (args, cwd) => run(process.execPath, [npmCli, ...args], cwd);
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
try {
  const [packed] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], root));
  const files = packed.files.map(file => file.path);
  for (const required of ['bin/gamehub.mjs', 'lib/commands.mjs', 'skills/gamehub-upload/SKILL.md', 'LICENSE', 'README.md']) {
    assert.ok(files.includes(required), `Package missing ${required}`);
  }
  assert.ok(files.every(path => !/^(tests|docs|scripts|node_modules)\//.test(path)), 'Package must contain only distributable client files');
  assert.ok(files.every(path => !/(^|\/)(\.env[^/]*|credentials\.json)$/.test(path)), 'Package must not contain secrets');
  const prefix = join(temporary, 'install');
  await mkdir(prefix);
  npm(['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, packed.filename)], temporary);
  const installed = join(prefix, 'node_modules', '@gamehub', 'cli');
  const executable = join(installed, 'bin', 'gamehub.mjs');
  const linkedBin = join(prefix, 'node_modules', '.bin', process.platform === 'win32' ? 'gamehub.cmd' : 'gamehub');
  await access(linkedBin);
  assert.match(npm(['exec', '--prefix', prefix, '--offline', '--', 'gamehub', '--help'], temporary), /gamehub upload/);
  const html = join(temporary, 'index.html');
  await writeFile(html, '<title>Cat Jump</title><h1>Jump and collect coins</h1>');
  const result = JSON.parse(run(process.execPath, [executable, 'upload', html, '--site', 'https://ugcplay.dev', '--title', 'Cat Jump', '--summary', 'Jump over obstacles and collect coins.', '--tags', 'platformer,casual', '--dry-run', '--json'], temporary));
  assert.equal(result.summary, 'Jump over obstacles and collect coins.');
  assert.deepEqual(result.tags, ['platformer', 'casual']);
  assert.equal(result.entry, 'index.html');
  const skill = await readFile(join(installed, 'skills', 'gamehub-upload', 'SKILL.md'), 'utf8');
  assert.match(skill, /^name: gamehub-upload$/m);
  // Run the full CLI contract suite against the installed tarball from outside both repositories.
  await cp(join(root, 'tests'), join(installed, 'tests'), { recursive: true });
  const tests = (await readdir(join(installed, 'tests'))).filter(name => name.endsWith('.test.mjs')).sort();
  const output = run(process.execPath, ['--test', '--test-concurrency=1', ...tests.map(name => join(installed, 'tests', name))], temporary);
  process.stdout.write(output);
  process.stdout.write(`Verified ${packed.filename}: ${files.length} distributable files, installed executable and skill, isolated CLI tests.\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
