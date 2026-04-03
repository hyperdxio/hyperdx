/**
 * Source map upload logic.
 *
 * Ported from hyperdx-js/packages/cli/src/lib.ts.
 * Authenticates via a service account API key (not session cookies),
 * globs for .js and .js.map files, and uploads them to presigned URLs.
 */

import { basename, join } from 'path';
import { cwd } from 'process';
import { readFileSync, statSync } from 'fs';

import { globSync } from 'glob';

const PKG_VERSION = '0.2.0';

export interface UploadSourcemapsOptions {
  allowNoop?: boolean;
  serviceKey: string;
  apiUrl?: string;
  apiVersion?: string;
  basePath?: string;
  path: string;
  releaseId?: string;
}

export async function uploadSourcemaps({
  allowNoop,
  serviceKey,
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

  const backend = apiUrl || 'https://api.hyperdx.io';
  const version = apiVersion || 'v1';

  const res = await fetch(join(backend, 'api', version), {
    method: 'get',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
    },
  })
    .then(response => response.json())
    .then(data => {
      return data as { user?: { team?: string } };
    })
    .catch(e => {
      console.log(e);
      return undefined;
    });

  const teamId = res?.user?.team;
  if (!teamId) {
    throw new Error('invalid service key');
  }

  console.info(`Starting to upload source maps from ${path}`);

  const fileList = getAllSourceMapFiles([path], { allowNoop });

  if (fileList.length === 0) {
    console.error(
      `Error: No source maps found in ${path}, is this the correct path?`,
    );
    console.info('Failed to upload source maps. Please see reason above.');
    return;
  }

  const uploadKeys = fileList.map(({ name }) => ({
    basePath: basePath || '',
    fullName: name,
    releaseId,
  }));

  const urlRes = await fetch(
    join(backend, 'api', version, 'sourcemaps', 'upload-presigned-urls'),
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
      return response.json();
    })
    .then(data => {
      return data as { data?: string[] };
    })
    .catch(e => {
      console.log(e);
      return undefined;
    });

  if (!Array.isArray(urlRes?.data)) {
    console.error('Error: Unable to generate source map upload urls.', urlRes);
    console.info('Failed to upload source maps. Please see reason above.');
    return;
  }

  const uploadUrls = urlRes.data;

  await Promise.all(
    fileList.map(({ path, name }, idx) =>
      uploadFile(path, uploadUrls[idx], name),
    ),
  );
}

// ---- Helpers -------------------------------------------------------

function getAllSourceMapFiles(
  paths: string[],
  { allowNoop }: { allowNoop?: boolean },
): { path: string; name: string }[] {
  const map: { path: string; name: string }[] = [];

  for (const path of paths) {
    const realPath = join(cwd(), path);

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
): Promise<void> {
  const fileContent = readFileSync(filePath);
  await fetch(uploadUrl, { method: 'put', body: fileContent });
  console.log(`[HyperDX] Uploaded ${filePath} to ${name}`);
}
