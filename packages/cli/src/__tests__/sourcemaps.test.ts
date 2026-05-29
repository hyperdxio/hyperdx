import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { uploadSourcemaps } from '@/sourcemaps';

type FetchMock = jest.Mock<typeof fetch>;

describe('uploadSourcemaps', () => {
  let tempDir: string;
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: FetchMock;
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;
  let originalEnvServiceKey: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sourcemaps-test-'));
    originalFetch = globalThis.fetch;
    mockFetch = jest.fn<typeof fetch>();
    globalThis.fetch = mockFetch;
    // Silence stdout/stderr by swapping write() with a no-op. Doing this via
    // jest.spyOn() trips overload-resolution on TS, so swap directly.
    originalStdoutWrite = process.stdout.write.bind(process.stdout);
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    originalEnvServiceKey = process.env.HYPERDX_SERVICE_KEY;
    delete process.env.HYPERDX_SERVICE_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    if (originalEnvServiceKey != null) {
      process.env.HYPERDX_SERVICE_KEY = originalEnvServiceKey;
    } else {
      delete process.env.HYPERDX_SERVICE_KEY;
    }
  });

  const okJson = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      json: async () => body,
    }) as Response;

  const httpStatus = (status: number): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({}),
    }) as Response;

  const createFile = (name: string, content = 'sourcemap content'): void => {
    writeFileSync(join(tempDir, name), content);
  };

  it('throws when serviceKey is empty and HYPERDX_SERVICE_KEY is unset', async () => {
    await expect(
      uploadSourcemaps({ serviceKey: '', path: tempDir }),
    ).rejects.toThrow('service key cannot be empty');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls back to HYPERDX_SERVICE_KEY env var when serviceKey arg is empty', async () => {
    process.env.HYPERDX_SERVICE_KEY = 'env-key';
    mockFetch.mockResolvedValueOnce(okJson({ user: { team: 'team-1' } }));

    // No files in tempDir + allowNoop=true → expected throw for "No source maps found".
    // The point of this test is to verify the env-key flows into the auth header.
    await expect(
      uploadSourcemaps({ serviceKey: '', path: tempDir, allowNoop: true }),
    ).rejects.toThrow('No source maps found');

    const [, init] = mockFetch.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer env-key');
  });

  it('throws "invalid service key" when authentication returns 401', async () => {
    mockFetch.mockResolvedValueOnce(httpStatus(401));
    await expect(
      uploadSourcemaps({ serviceKey: 'bad-key', path: tempDir }),
    ).rejects.toThrow('invalid service key');
  });

  it('throws when no .js.map files are found and allowNoop is false', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ user: { team: 'team-1' } }));
    // tempDir is empty and allowNoop defaults to false → getAllSourceMapFiles
    // throws the "No .js.map files found" error, which now propagates.
    await expect(
      uploadSourcemaps({ serviceKey: 'key', path: tempDir }),
    ).rejects.toThrow('No .js.map files found');
  });

  it('throws when no source maps are found and allowNoop is true', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ user: { team: 'team-1' } }));
    await expect(
      uploadSourcemaps({
        serviceKey: 'key',
        path: tempDir,
        allowNoop: true,
      }),
    ).rejects.toThrow(`No source maps found in ${tempDir}`);
  });

  it('throws when the pre-signed URL endpoint returns a non-array', async () => {
    createFile('a.js.map');
    mockFetch
      .mockResolvedValueOnce(okJson({ user: { team: 'team-1' } }))
      .mockResolvedValueOnce(
        okJson({
          /* missing data field */
        }),
      );

    await expect(
      uploadSourcemaps({ serviceKey: 'key', path: tempDir }),
    ).rejects.toThrow('Failed to get source map upload URLs');
  });

  it('throws when one or more file uploads fail after retries', async () => {
    createFile('a.js.map');
    createFile('b.js.map');
    mockFetch
      .mockResolvedValueOnce(okJson({ user: { team: 'team-1' } }))
      .mockResolvedValueOnce(
        okJson({ data: ['https://upload-1', 'https://upload-2'] }),
      )
      // First PUT succeeds.
      .mockResolvedValueOnce(httpStatus(200))
      // Second PUT returns 4xx (permanent failure, no retry per uploadFile()).
      .mockResolvedValueOnce(httpStatus(403));

    await expect(
      uploadSourcemaps({ serviceKey: 'key', path: tempDir }),
    ).rejects.toThrow(/source map upload\(s\) failed/);
  });

  it('resolves cleanly when all files upload successfully', async () => {
    createFile('a.js');
    createFile('a.js.map');
    mockFetch
      .mockResolvedValueOnce(okJson({ user: { team: 'team-1' } }))
      .mockResolvedValueOnce(
        okJson({ data: ['https://upload-1', 'https://upload-2'] }),
      )
      .mockResolvedValueOnce(httpStatus(200))
      .mockResolvedValueOnce(httpStatus(200));

    await expect(
      uploadSourcemaps({ serviceKey: 'key', path: tempDir }),
    ).resolves.toBeUndefined();
  });
});
