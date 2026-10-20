#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { siteOrigin } from '../lib/api.mjs';
import { execute } from '../lib/commands.mjs';

const HELP = `gamehub — Game Hub CLI (Node 22+)

gamehub login [--no-browser] --site <origin>
gamehub whoami | logout --site <origin>
gamehub tokens [list | revoke <token-id>] --site <origin>
gamehub upload <html|zip|directory> --title <title> [options]
gamehub link <https-url> --title <title> [--mirror] [options]

Options:
  --site <origin>       Required unless GAMEHUB_SITE is set
  --json                Machine-readable stdout (progress goes to stderr)
  --summary <text>      Up to 500 characters
  --tags <a,b,c>        Up to 3 tags
  --entry <path>        Package HTML entry (default index.html or sole HTML)
  --cover <path>        Package PNG/JPG/WebP/GIF cover
  --game-id <id>        Update a game owned by the logged-in account
  --version-note <text> Required for updates, up to 200 characters
  --guest               Force anonymous URL submission (link only)
  --dry-run             Validate and print upload plan without network writes

GAMEHUB_CONFIG_DIR overrides the private credentials directory.
GAMEHUB_TOKEN supplies a site-specific CI credential; never pass it as an argument.
`;
const boolean = ['help', 'json', 'no-browser', 'guest', 'mirror', 'dry-run'];
const string = ['site', 'title', 'summary', 'tags', 'entry', 'cover', 'game-id', 'version-note'];
try {
  const { values, positionals } = parseArgs({ options: Object.fromEntries([...boolean.map(k => [k, { type: 'boolean' }]), ...string.map(k => [k, { type: 'string' }])]), allowPositionals: true, strict: true });
  if (values.help || !positionals.length) { process.stdout.write(HELP); }
  else {
    const [command, input, tokenId, ...extra] = positionals;
    if (!['login', 'whoami', 'logout', 'tokens', 'upload', 'link'].includes(command)) throw new Error('Unknown command: ' + command);
    if (extra.length || (tokenId && command !== 'tokens') || (input && !['upload', 'link', 'tokens'].includes(command))) throw new Error('Unexpected command arguments');
    const allowed = {
      login: ['no-browser'], whoami: [], logout: [], tokens: [],
      upload: ['title', 'summary', 'tags', 'entry', 'cover', 'game-id', 'version-note', 'dry-run'],
      link: ['title', 'summary', 'tags', 'game-id', 'version-note', 'guest', 'dry-run', 'mirror'],
    };
    for (const key of Object.keys(values)) if (!['site', 'json', ...allowed[command]].includes(key)) throw new Error(`--${key} is not supported by ${command}`);
    const site = siteOrigin(values.site || process.env.GAMEHUB_SITE || '');
    const result = await execute(command, input, { ...values, tokenId }, site);
    process.stdout.write(values.json ? JSON.stringify(result) + '\n' : JSON.stringify(result, null, 2) + '\n');
  }
} catch (error) {
  const body = { ok: false, error: error.message, ...(error.status ? { status: error.status } : {}), ...(error.code ? { code: error.code } : {}), ...(error.uploadId ? { uploadId: error.uploadId } : {}) };
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(body) + '\n');
  else process.stderr.write('gamehub: ' + body.error + '\n');
  process.exitCode = 1;
}
