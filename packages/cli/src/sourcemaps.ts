/**
 * Source map upload logic.
 *
 * Ported from hyperdx-js/packages/cli/src/lib.ts.
 * Authenticates via a service account API key (not session cookies),
 * globs for .js and .js.map files, and uploads them to presigned URLs.
 */

import { basename, join, resolve } from 'path';
import { readFileSync, statSync } from 'fs';

import { globSync } from 'glob';
import { createRequire } from 'module';

// Use process.stderr/stdout directly because console.error/log/info
// are silenced by silenceLogs.ts for the TUI mode.
const log = (msg: string) => process.stdout.write(`${msg}\n`);
const logError = (msg: string) => process.stderr.write(`${msg}\n`);

const require = createRequire(import.meta.url);
const PKG_VERSION: string = (require('../package.json') as { version: string })
  .version;

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000]; // ms between retries
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Join URL paths without mangling the protocol (path.join strips '//') */
function urlJoin(base: string, ...segments: string[]): string {
  const url = new URL(
    segments.join('/'),
    base.endsWith('/') ? base : `${base}/`,
  );
  return url.toString();
}

export interface UploadSourcemapsOptions {
  allowNoop?: boolean;
  serviceKey: string;
  appUrl?: string;
  /** @deprecated Use appUrl instead. */
  apiUrl?: string;
  apiVersion?: string;
  basePath?: string;
  path: string;
  releaseId?: string;
}

export async function uploadSourcemaps({
  allowNoop,
  serviceKey,
  appUrl,
  apiUrl,
  apiVersion,
  basePath,
  path,
  releaseId,
}: UploadSourcemapsOptions): Promise<void> {
  if (!serviceKey || serviceKey === '') {
    if (process.env.HYPERDX_SERVICE_KEY) {
      serviceKey = process.env.HYPERDX_SERVICE_KEY;
    } else {
      throw new Error('service key cannot be empty');
    }
  }

  if (apiUrl && !appUrl) {
    logError(
      '[HyperDX] Warning: --apiUrl is deprecated. Use --appUrl instead (the HyperDX app URL).',
    );
    appUrl = apiUrl;
  }

  const backend = appUrl || 'https://api.hyperdx.io';
  const version = apiVersion || 'v1';

  const res = await fetch(urlJoin(backend, 'api', version), {
    method: 'get',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
    },
  })
    .then(response => {
      if (!response.ok) {
        throw new Error(
          `Authentication failed (${response.status}). Check your --serviceKey and --appUrl.`,
        );
      }
      return response.json();
    })
    .then(data => {
      return data as { user?: { team?: string } };
    })
    .catch(e => {
      logError(e.message || String(e));
      return undefined;
    });

  const teamId = res?.user?.team;
  if (!teamId) {
    throw new Error('invalid service key');
  }

  log(`Starting to upload source maps from ${path}`);

  const fileList = getAllSourceMapFiles([path], { allowNoop });

  if (fileList.length === 0) {
    logError(
      `Error: No source maps found in ${path}, is this the correct path?`,
    );
    logError('Failed to upload source maps. Please see reason above.');
    return;
  }

  const uploadKeys = fileList.map(({ name }) => ({
    basePath: basePath || '',
    fullName: name,
    releaseId,
  }));

  const urlRes = await fetch(
    urlJoin(backend, 'api', version, 'sourcemaps', 'upload-presigned-urls'),
    {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        pkgVersion: PKG_VERSION,
        keys: uploadKeys,
      }),
    },
  )
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to get upload URLs (${response.status}).`);
      }
      return response.json();
    })
    .then(data => {
      return data as { data?: string[] };
    })
    .catch(e => {
      logError(e.message || String(e));
      return undefined;
    });

  if (!Array.isArray(urlRes?.data)) {
    logError(
      `Error: Unable to generate source map upload urls. Response: ${JSON.stringify(urlRes)}`,
    );
    logError('Failed to upload source maps. Please see reason above.');
    return;
  }

  const uploadUrls = urlRes.data;

  const results = await Promise.all(
    fileList.map(({ path, name }, idx) =>
      uploadFile(path, uploadUrls[idx], name, idx, fileList.length),
    ),
  );

  const succeeded = results.filter(Boolean).length;
  const failed = results.length - succeeded;
  log(
    `\n[HyperDX] Upload complete: ${succeeded} succeeded, ${failed} failed out of ${results.length} files.`,
  );
  if (failed > 0) {
    logError('[HyperDX] Some files failed to upload. See errors above.');
  }
}

// ---- Helpers -------------------------------------------------------

function getAllSourceMapFiles(
  paths: string[],
  { allowNoop }: { allowNoop?: boolean },
): { path: string; name: string }[] {
  const map: { path: string; name: string }[] = [];

  for (const path of paths) {
    const realPath = resolve(path);

    if (statSync(realPath).isFile()) {
      map.push({
        path: realPath,
        name: basename(realPath),
      });
      continue;
    }

    if (
      !allowNoop &&
      !globSync('**/*.js.map', {
        cwd: realPath,
        nodir: true,
        ignore: '**/node_modules/**/*',
      }).length
    ) {
      throw new Error(
        'No .js.map files found. Please double check that you have generated sourcemaps for your app.',
      );
    }

    for (const file of globSync('**/*.js?(.map)', {
      cwd: realPath,
      nodir: true,
      ignore: '**/node_modules/**/*',
    })) {
      map.push({
        path: join(realPath, file),
        name: file,
      });
      const routeGroupRemovedPath = file.replaceAll(
        new RegExp(/(\(.+?\))\//gm),
        '',
      );
      if (file !== routeGroupRemovedPath) {
        // also upload the file to a path without the route group for frontend errors
        map.push({
          path: join(realPath, file),
          name: routeGroupRemovedPath,
        });
      }
    }
  }

  return map;
}

async function uploadFile(
  filePath: string,
  uploadUrl: string,
  name: string,
  index: number,
  total: number,
): Promise<boolean> {
  const fileContent = readFileSync(filePath);
  const prefix = `[HyperDX] [${index + 1}/${total}]`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(uploadUrl, { method: 'put', body: fileContent });
      if (res.ok) {
        log(`${prefix} Uploaded ${name}`);
        return true;
      }
      // 4xx — permanent failure, don't retry
      if (res.status >= 400 && res.status < 500) {
        logError(`${prefix} Failed to upload ${name} (${res.status})`);
        return false;
      }
      // 5xx — server error, retry
      throw new Error(`Server error (${res.status})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt - 1] ?? 3000;
        logError(
          `${prefix} Upload failed (${msg}), retrying in ${delay / 1000}s...`,
        );
        await sleep(delay);
      } else {
        logError(
          `${prefix} Failed to upload ${name} after ${MAX_RETRIES} attempts: ${msg}`,
        );
        return false;
      }
    }
  }
  return false;
}
