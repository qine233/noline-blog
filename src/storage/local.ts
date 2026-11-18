import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { UploadInput, UploadResult } from './types.js';

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
};

// Local driver — stores under public/uploads. Meant for local testing or
// self-hosting; OneDrive / Cloudreve are the intended production backends.
export async function localUpload(input: UploadInput): Promise<UploadResult> {
  const dir = path.join(process.cwd(), 'public', 'uploads');
  mkdirSync(dir, { recursive: true });
  const ext = path.extname(input.name).toLowerCase() || MIME_EXT[input.mime] || '';
  const name = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}${ext}`;
  writeFileSync(path.join(dir, name), input.data);
  return { url: `/uploads/${name}` };
}
