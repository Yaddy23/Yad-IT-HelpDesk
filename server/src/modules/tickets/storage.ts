import { AppError } from '../../core/errors.js';
import { env } from '../../config/env.js';

/**
 * Minimal Supabase Storage client (REST only — no SDK dependency). All calls
 * use the service-role key and MUST stay server-side; the bucket is private
 * and objects are only reachable through short-lived signed URLs we mint.
 */

function storageConfig(): { base: string; key: string; bucket: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError(
      503,
      'File storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)',
      'STORAGE_UNAVAILABLE',
    );
  }
  return {
    base: `${env.SUPABASE_URL}/storage/v1`,
    key: env.SUPABASE_SERVICE_ROLE_KEY,
    bucket: env.ATTACHMENTS_BUCKET,
  };
}

export function storageEnabled(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Uploads bytes to the private bucket. Overwrites are rejected (fresh UUID paths). */
export async function putObject(path: string, body: Buffer, contentType: string): Promise<void> {
  const { base, key, bucket } = storageConfig();
  const res = await fetch(`${base}/object/${bucket}/${encodePath(path)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': contentType, 'x-upsert': 'false' },
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    throw new AppError(502, `Storage upload failed (${res.status})`, 'STORAGE_UPLOAD_FAILED');
  }
}

/** Mints a short-lived signed URL for a mediated download. */
export async function createSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
  const { base, key, bucket } = storageConfig();
  const res = await fetch(`${base}/object/sign/${bucket}/${encodePath(path)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
  });
  if (!res.ok) {
    throw new AppError(502, `Storage sign failed (${res.status})`, 'STORAGE_SIGN_FAILED');
  }
  const json = (await res.json()) as { signedURL?: string };
  if (!json.signedURL) throw new AppError(502, 'Storage sign returned no URL', 'STORAGE_SIGN_FAILED');
  return `${env.SUPABASE_URL}/storage/v1${json.signedURL}`;
}

/** Best-effort delete (used when the DB row insert fails after upload). */
export async function deleteObject(path: string): Promise<void> {
  const { base, key, bucket } = storageConfig();
  await fetch(`${base}/object/${bucket}/${encodePath(path)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${key}` },
  }).catch(() => undefined);
}

/** Encodes each path segment; slashes stay literal. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
