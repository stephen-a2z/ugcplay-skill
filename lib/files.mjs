import { lstat, readdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { Unzip, UnzipInflate } from 'fflate';
import { ALLOWED_EXT, MAX_FILES, MAX_SINGLE_FILE, MAX_TOTAL_UNZIPPED } from './policy.mjs';

const ignored = path => path.split('/').some(p => p.startsWith('.') || p === '__MACOSX');
function safePath(path) {
  if (!path || path.length > 200 || path.includes('\\') || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || /[\x00-\x1f]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid file path: ' + path);
}
export function validatePath(path) {
  safePath(path);
  if (!ALLOWED_EXT.has(path.split('.').at(-1).toLowerCase())) throw new Error('Unsupported file type: ' + path);
  return path;
}
function checkList(list) {
  if (!list.length || list.length > MAX_FILES) throw new Error(`File count limit: 1–${MAX_FILES}`);
  if (new Set(list.map(f => f.path)).size !== list.length) throw new Error('Duplicate file paths');
  for (const f of list) {
    validatePath(f.path);
    if (!Number.isSafeInteger(f.size) || f.size < 0 || f.size > MAX_SINGLE_FILE) throw new Error('File size limit exceeded: ' + f.path);
  }
  if (list.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_UNZIPPED) throw new Error('Total size limit exceeded (100MB)');
}
async function readBounded(path, limit) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new Error('File size limit exceeded: ' + path);
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('File changed while reading: ' + path);
      offset += bytesRead;
    }
    if ((await handle.stat()).size !== info.size) throw new Error('File changed while reading: ' + path);
    return bytes;
  } finally { await handle.close(); }
}
// ZIP CRC-32 (IEEE), updated incrementally as bounded chunks decompress.
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function updateCrc(crc, bytes) {
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
  return crc >>> 0;
}
function unzipBounded(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === bytes.length) { end = p; break; }
  }
  if (end < 0) throw new Error('Invalid ZIP directory');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (view.getUint32(end + 4, true) || count !== view.getUint16(end + 8, true) || count === 65535 || count > 2000 || offset + view.getUint32(end + 12, true) !== end) throw new Error('Unsupported ZIP layout (ZIP64/multi-disk)');
  const list = [], names = new Set();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const nameLength = view.getUint16(offset + 28, true);
    const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (next > end) throw new Error('Invalid ZIP directory');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    safePath(name.replace(/\/$/, ''));
    if (names.has(name)) throw new Error('Duplicate ZIP paths'); names.add(name);
    if (((view.getUint32(offset + 38, true) >>> 16) & 0xf000) === 0xa000) throw new Error('ZIP symbolic links are not supported');
    if (view.getUint16(offset + 8, true) & 1) throw new Error('Encrypted ZIP is not supported');
    if (!name.endsWith('/') && !ignored(name)) list.push({ path: name, size: view.getUint32(offset + 24, true), crc: view.getUint32(offset + 16, true) });
    offset = next;
  }
  if (offset !== end) throw new Error('Invalid ZIP directory size');
  checkList(list);
  const wanted = new Map(list.map(f => [f.path, f]));
  const seen = new Set(); let total = 0;
  const unzip = new Unzip(file => {
    const expected = wanted.get(file.name);
    if (!expected) {
      if (!names.has(file.name)) throw new Error('ZIP local path differs from directory');
      return;
    }
    if (seen.has(file.name)) throw new Error('Duplicate ZIP paths'); seen.add(file.name);
    const chunks = []; let size = 0; let crc = 0xffffffff;
    file.ondata = (error, data, final) => {
      if (error) throw error;
      size += data.length; total += data.length;
      if (size > expected.size || total > MAX_TOTAL_UNZIPPED) throw new Error('ZIP actual size exceeds declared size limit');
      crc = updateCrc(crc, data);
      chunks.push(data);
      if (final) {
        if (size !== expected.size) throw new Error('ZIP file size mismatch');
        if (((crc ^ 0xffffffff) >>> 0) !== expected.crc) throw new Error('ZIP CRC mismatch: ' + file.name);
        expected.bytes = Buffer.concat(chunks, size);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let p = 0; p < bytes.length; p += 4096) unzip.push(bytes.subarray(p, p + 4096), p + 4096 >= bytes.length);
  if (list.some(f => !f.bytes)) throw new Error('Incomplete ZIP archive');
  return list;
}
export async function collectFiles(input, entry) {
  const path = resolve(input); const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error('Symbolic links are not supported');
  let files = [];
  if (info.isDirectory()) {
    const walk = async (dir, prefix = '') => {
      for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const relative = prefix + item.name;
        if (ignored(relative)) continue;
        if (item.isSymbolicLink()) throw new Error('Symbolic links are not supported: ' + relative);
        if (item.isDirectory()) {
          if (item.name === 'node_modules') throw new Error('Upload a build directory, not node_modules');
          await walk(join(dir, item.name), relative + '/');
        } else if (item.isFile()) {
          validatePath(relative);
          files.push({ path: relative, size: (await lstat(join(dir, item.name))).size, source: join(dir, item.name) });
          checkList(files);
        } else throw new Error('Unsupported filesystem entry: ' + relative);
      }
    };
    await walk(path); checkList(files);
    for (const f of files) { f.bytes = await readBounded(f.source, MAX_SINGLE_FILE); if (f.bytes.length !== f.size) throw new Error('File changed: ' + f.path); delete f.source; }
  } else if (info.isFile() && /\.zip$/i.test(path)) {
    files = unzipBounded(await readBounded(path, MAX_TOTAL_UNZIPPED));
  } else if (info.isFile() && /\.html?$/i.test(path)) {
    const bytes = await readBounded(path, MAX_SINGLE_FILE); files = [{ path: basename(path), size: bytes.length, bytes }];
  } else throw new Error('Input must be an HTML file, ZIP, or build directory');
  checkList(files);
  const html = files.filter(f => /\.html?$/i.test(f.path));
  const chosen = entry || (files.some(f => f.path === 'index.html') ? 'index.html' : html.length === 1 ? html[0].path : null);
  if (!chosen || !html.some(f => f.path === chosen)) throw new Error('Select a package HTML entry with --entry');
  return { files, entry: chosen, bytes: files.reduce((n, f) => n + f.size, 0) };
}
