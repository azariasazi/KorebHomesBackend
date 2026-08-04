import { isAbsolute, resolve } from 'path';

/**
 * The single source of truth for where local uploads live on disk.
 *
 * BOTH the code that writes uploaded photos (PhotosService) AND the code that
 * serves them over HTTP (main.ts static assets) call this, so the "save
 * directory" and the "served directory" can never drift apart. That drift is
 * the most common way the /uploads 404 fix gets done wrong — it appears to work
 * but still 404s because two hardcoded paths disagree.
 *
 * Resolves STORAGE_LOCAL_PATH (default "./uploads") to an ABSOLUTE path against
 * the process working directory, which is the project root both in dev
 * (`nest start`) and in production (`node dist/main`). An absolute
 * STORAGE_LOCAL_PATH is honoured as-is.
 */
export function resolveUploadsDir(storageLocalPath?: string): string {
  const configured = storageLocalPath ?? process.env.STORAGE_LOCAL_PATH ?? './uploads';
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

/** The URL path prefix uploads are served under. Kept in one place too. */
export const UPLOADS_URL_PREFIX = '/uploads';
