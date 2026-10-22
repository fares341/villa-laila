import fs from 'node:fs';
import path from 'node:path';

/**
 * Files uploaded from the dashboard or the admin bot (event videos). Kept on a Docker volume so they survive
 * rebuilds: docker-compose mounts ./uploads at /app/data/uploads for the web and worker containers.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads');
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 4096) * 1024 * 1024; // 4 GB per file by default

export function uploadPath(rel: string) {
  const p = path.resolve(UPLOAD_DIR, rel);
  if (!p.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) throw new Error('bad path');
  return p;
}
export async function ensureDir(rel: string) { await fs.promises.mkdir(uploadPath(rel), { recursive: true }); }

export async function saveBuffer(rel: string, data: Buffer) {
  await fs.promises.mkdir(path.dirname(uploadPath(rel)), { recursive: true });
  await fs.promises.writeFile(uploadPath(rel), data);
}
export async function removeFile(rel: string | null | undefined) {
  if (!rel) return;
  await fs.promises.unlink(uploadPath(rel)).catch(() => {});
}
export const extFor = (mime: string, name = '') => {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  return ({ 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[mime] ?? 'bin';
};
