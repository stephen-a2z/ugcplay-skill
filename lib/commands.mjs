import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { apiClient } from './api.mjs';
import { credentialFor, saveCredential, readCredentials } from './credentials.mjs';
import { collectFiles, validatePath } from './files.mjs';
import { uploadSession, completedGame } from './responses.mjs';

const log = message => process.stderr.write(message + '\n');
function openBrowser(url) {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => log('Open the verification URL above in your browser.'));
  child.unref();
}
function metadata(options) {
  const title = options.title?.trim();
  const summary = options.summary?.trim() || '';
  const tags = options.tags ? options.tags.split(',').map(s => s.trim()).filter(Boolean) : [];
  const versionNote = options['version-note']?.trim() || '';
  if (!title || title.length > 60) throw new Error('--title is required (1–60 characters)');
  if (summary.length > 500 || tags.length > 3 || tags.some(t => t.length > 12) || versionNote.length > 200) throw new Error('Metadata exceeds site limits (summary 500, tags 3 × 12, version note 200 characters)');
  const gameId = options['game-id'];
  if (gameId && !/^[0123456789abcdefghjkmnpqrstvwxyz]{8}$/.test(gameId)) throw new Error('Invalid --game-id');
  if (gameId && !versionNote) throw new Error('Updates require --version-note');
  if (options.guest && gameId) throw new Error('Guest uploads cannot update existing games');
  return { title, summary, tags, ...(gameId ? { gameId } : {}), versionNote };
}
async function authenticated(site, required = true) {
  const credential = process.env.UGCPLAY_TOKEN
    ? { token: process.env.UGCPLAY_TOKEN }
    : required ? await credentialFor(site) : (await readCredentials())[site];
  if (!credential || credential.expiresAt <= Date.now()) return null;
  return apiClient(site, credential.token);
}
async function resultFor(site, api, result) {
  let status = null;
  try { status = (await api('/api/games/' + encodeURIComponent(result.id), { anonymous: true })).game?.status ?? null; } catch { /* Submission already succeeded; status lookup must not cause a duplicate retry. */ }
  return { ok: true, id: result.id, slug: result.slug, shareUrl: `${site}/zh/g/${encodeURIComponent(result.id)}`, status, ...(result.warning ? { warning: result.warning } : {}), ...(result.claimToken ? { claimToken: result.claimToken } : {}) };
}
async function finalize(site, api, upload) {
  try { return await resultFor(site, api, completedGame(await api('/api/upload/finalize', { method: 'POST', json: { id: upload.id }, retry: true }), { gameId: upload.gameId })); }
  catch (error) { error.uploadId = upload.id; error.message += `; uploadId=${upload.id}. Finalization may have succeeded; check the game before submitting again.`; throw error; }
}
async function cancelAfterFailure(api, upload, error) {
  error.uploadId = upload.id;
  try { await api('/api/upload/cancel', { method: 'POST', json: { id: upload.id } }); }
  catch { error.message += `; unfinished uploadId=${upload.id} (automatic cleanup pending)`; }
  throw error;
}
export async function execute(command, input, options, site) {
  const anonymous = apiClient(site);
  if (command === 'login') {
    const d = await anonymous('/api/auth/cli/device', { method: 'POST', json: {} });
    const url = new URL(d.verificationUri);
    if (url.origin !== site) throw new Error('Verification URL does not belong to the selected site');
    log(`Open ${url.href}\nVerify code: ${d.userCode}\nWaiting for browser approval…`);
    if (!options['no-browser']) openBrowser(url.href);
    const deadline = Date.now() + Math.min(d.expiresIn, 600) * 1000;
    while (Date.now() < deadline) {
      await sleep(Math.max(10, Math.min(5000, d.interval * 1000)));
      const auth = await anonymous('/api/auth/cli/poll', { method: 'POST', json: { deviceCode: d.deviceCode } });
      if (auth.status === 'pending') continue;
      if (auth.status !== 'authorized' || !/^ghu_[A-Za-z0-9_-]{43}$/.test(auth.token) || !Number.isFinite(auth.expiresAt)) throw new Error('Invalid login response');
      const api = apiClient(site, auth.token);
      const identity = await api('/api/auth/me');
      if (!identity.user || identity.banned) throw new Error('Account is unavailable');
      await saveCredential(site, { token: auth.token, tokenId: auth.tokenId, expiresAt: auth.expiresAt });
      return { ok: true, user: identity.user, site, expiresAt: auth.expiresAt };
    }
    throw new Error('Login expired. Run ugcplay login again.');
  }
  if (command === 'logout') {
    if (process.env.UGCPLAY_TOKEN) throw new Error('UGCPLAY_TOKEN is set. Use tokens revoke <id> to revoke it, then remove the environment variable.');
    const credential = (await readCredentials())[site];
    if (!credential) return { ok: true, site };
    if (credential.expiresAt > Date.now()) {
      try { await apiClient(site, credential.token)('/api/auth/cli/tokens/' + encodeURIComponent(credential.tokenId), { method: 'DELETE' }); }
      catch (error) { if (![401, 403].includes(error.status)) throw new Error('Could not revoke remote credential; local login retained. ' + error.message); }
    }
    await saveCredential(site, null);
    return { ok: true, site };
  }
  if (command === 'whoami') {
    const identity = await (await authenticated(site))('/api/auth/me');
    if (!identity.user || identity.banned) throw new Error('Credential revoked, expired, or account unavailable. Run ugcplay login.');
    return { ok: true, ...identity };
  }
  if (command === 'tokens') {
    const api = await authenticated(site);
    if (!input || input === 'list') return { ok: true, ...await api('/api/auth/cli/tokens') };
    if (input !== 'revoke' || !options.tokenId || !/^[a-f0-9-]{36}$/.test(options.tokenId)) throw new Error('Usage: ugcplay tokens revoke <token-id>');
    return api('/api/auth/cli/tokens/' + options.tokenId, { method: 'DELETE' });
  }
  const meta = metadata(options);
  if (!input) throw new Error('Specify a file/directory for upload or an HTTPS URL for link');
  if (command === 'link') {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Link must be an HTTPS URL without credentials');
    // A saved login keeps attribution; new URL submissions also work without one.
    // Updates always need an account, and auth errors never trigger guest resubmission.
    const account = options.guest ? null : await authenticated(site, !!meta.gameId && !options['dry-run']);
    const guest = !account && !meta.gameId;
    const body = { ...meta, url: url.href, guest, mirror: !!options.mirror };
    if (options['dry-run']) return { ok: true, dryRun: true, site, ...body };
    const api = account || anonymous;
    const upload = await api('/api/upload/link', { method: 'POST', json: body, timeout: 120000 });
    if (guest) return resultFor(site, api, completedGame(upload, { guest: true }));
    return finalize(site, api, uploadSession(upload, meta.gameId));
  }
  if (options.guest) throw new Error('--guest is not supported by upload; file uploads require login');
  const bundle = await collectFiles(input, options.entry);
  let cover;
  if (options.cover) {
    cover = validatePath(options.cover);
    if (!/\.(png|jpe?g|webp|gif)$/i.test(cover) || !bundle.files.some(f => f.path === cover)) throw new Error('--cover must be an image in the package');
  }
  const manifest = { ...meta, entry: bundle.entry, files: bundle.files.map(({ path, size }) => ({ path, size })), ...(cover ? { cover } : {}) };
  if (options['dry-run']) return { ok: true, dryRun: true, site, guest: false, bytes: bundle.bytes, ...manifest };
  const api = await authenticated(site);
  const upload = uploadSession(await api('/api/upload/init', { method: 'POST', json: manifest }), meta.gameId);
  try {
    for (const file of bundle.files) {
      log('Uploading ' + file.path);
      await api('/api/upload/put', { method: 'PUT', body: file.bytes, headers: { 'Content-Type': 'application/octet-stream', 'x-upload-id': upload.id, 'x-file-path': encodeURIComponent(file.path) }, retry: true, timeout: 300000 });
    }
  } catch (error) { await cancelAfterFailure(api, upload, error); }
  return finalize(site, api, upload);
}
