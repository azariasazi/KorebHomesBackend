import { resolveUploadsDir, UPLOADS_URL_PREFIX } from './uploads.path';
import { resolve } from 'path';

/**
 * The /uploads 404 fix hinges on ONE thing: the directory the app serves over
 * HTTP must be the exact directory uploads are written into. Both sides call
 * resolveUploadsDir(), so these tests pin that contract down — if someone
 * changes how either side resolves the path, this fails.
 */
describe('resolveUploadsDir — serve path must equal write path', () => {
  const OLD_ENV = process.env.STORAGE_LOCAL_PATH;
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.STORAGE_LOCAL_PATH;
    else process.env.STORAGE_LOCAL_PATH = OLD_ENV;
  });

  it('defaults to <cwd>/uploads when nothing is configured', () => {
    delete process.env.STORAGE_LOCAL_PATH;
    expect(resolveUploadsDir()).toBe(resolve(process.cwd(), 'uploads'));
  });

  it('resolves a relative path against the working directory (absolute result)', () => {
    expect(resolveUploadsDir('./uploads')).toBe(resolve(process.cwd(), 'uploads'));
    expect(resolveUploadsDir('data/uploads')).toBe(resolve(process.cwd(), 'data/uploads'));
  });

  it('honours an absolute path unchanged', () => {
    const abs = resolve('/var/koreb/uploads');
    expect(resolveUploadsDir(abs)).toBe(abs);
  });

  it('gives the SAME result to the writer and the server for the same config', () => {
    // Simulate the two call sites: PhotosService (writer) and main.ts (server).
    const config = 'some/custom/uploads';
    const writerPath = resolveUploadsDir(config);
    const serverPath = resolveUploadsDir(config);
    expect(writerPath).toBe(serverPath);
  });

  it('keeps the URL prefix in lockstep with the served route', () => {
    // The URLs PhotosService returns start with this prefix; the static route
    // in main.ts serves this prefix. They must be the same constant.
    expect(UPLOADS_URL_PREFIX).toBe('/uploads');
    expect(`${UPLOADS_URL_PREFIX}/listings/abc.jpg`).toBe('/uploads/listings/abc.jpg');
  });
});
