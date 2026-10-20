import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { collectFiles } from '../lib/files.mjs';

test('ZIP integrity checks reject CRC mismatches for stored and compressed files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ugcplay-crc-'));
  const path = join(dir, 'game.zip');
  try {
    for (const level of [0, 6]) {
      const zip = zipSync({ 'index.html': new TextEncoder().encode('ORIGINAL'.repeat(3000)), 'empty.txt': new Uint8Array() }, { level });
      await writeFile(path, zip);
      assert.equal((await collectFiles(path)).files.length, 2, 'valid CRC including an empty file');
      const central = Buffer.from(zip).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      // Change the recorded CRC in both headers, so header consistency alone cannot pass this test.
      const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
      view.setUint32(central + 16, view.getUint32(central + 16, true) ^ 1, true);
      view.setUint32(14, view.getUint32(14, true) ^ 1, true);
      await writeFile(path, zip);
      await assert.rejects(collectFiles(path), /CRC/i);
    }
    const stored = zipSync({ 'index.html': new TextEncoder().encode('ORIGINAL') }, { level: 0 });
    stored[Buffer.from(stored).indexOf(Buffer.from('ORIGINAL'))] ^= 1;
    await writeFile(path, stored);
    await assert.rejects(collectFiles(path), /CRC/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
