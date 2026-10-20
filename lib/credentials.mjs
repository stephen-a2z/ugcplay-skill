import { mkdir, readFile, readdir, open, rename, rm, chmod, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const directory = () => process.env.UGCPLAY_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'ugcplay');
const filename = site => `site-${createHash('sha256').update(site).digest('hex')}.json`;
async function readJson(path) {
  if ((await lstat(path)).isSymbolicLink()) throw new Error('Credentials file must not be a symbolic link');
  const data = JSON.parse(await readFile(path, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid credentials file');
  return data;
}
export async function readCredentials() {
  const dir = directory();
  let all;
  try { all = await readJson(join(dir, 'credentials.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; all = {}; }
  let names;
  try { names = await readdir(dir); }
  catch (error) { if (error.code === 'ENOENT') return all; throw error; }
  for (const name of names.filter(name => /^site-[a-f0-9]{64}\.json$/.test(name))) {
    const entry = await readJson(join(dir, name));
    if (typeof entry.site !== 'string' || filename(entry.site) !== name || !Object.hasOwn(entry, 'credential') ||
        (entry.credential !== null && (typeof entry.credential !== 'object' || Array.isArray(entry.credential)))) throw new Error('Invalid site credentials file');
    // A null entry suppresses an old-format login without rewriting shared state.
    if (entry.credential === null) delete all[entry.site];
    else all[entry.site] = entry.credential;
  }
  return all;
}
export async function credentialFor(site) {
  const entry = (await readCredentials())[site];
  if (!entry || entry.expiresAt <= Date.now()) throw new Error('Not logged in or credential expired. Run ugcplay login --site ' + site);
  return entry;
}
export async function saveCredential(site, value) {
  const dir = directory();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await lstat(dir)).isSymbolicLink()) throw new Error('Credentials directory must not be a symbolic link');
  await chmod(dir, 0o700);
  // Separate atomic files prevent logins in other processes/sites losing updates.
  const path = join(dir, filename(site));
  const temporary = join(dir, `credentials-${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify({ site, credential: value ?? null }, null, 2) + '\n'); } finally { await file.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
