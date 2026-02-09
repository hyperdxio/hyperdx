const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);

// removes pyodide from a next static build. We want a small bundle size, so that feature would just be ignored
const pyodidePath = path.join(__dirname, '../out/pyodide');
if (fs.existsSync(pyodidePath)) {
  fs.rmSync(pyodidePath, { recursive: true, force: true });
  console.log('Removed pyodide from static build');
}

const outDir = path.join(__dirname, '../out');

// Remove all files that are not html, js, or css
function removeNonEssentialFiles(dir) {
  const allowedExtensions = [
    '.html',
    '.js',
    '.css',
    '.map',
    '.woff2',
    '.png',
    '.svg',
    '.ico',
  ];
  let removedCount = 0;

  function walkDir(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!allowedExtensions.includes(ext)) {
          fs.unlinkSync(fullPath);
          console.log(
            `Removed non-essential file: ${path.relative(outDir, fullPath)}`,
          );
          removedCount++;
        }
      }
    }
  }

  walkDir(dir);
  console.log(`Removed ${removedCount} non-essential file(s)`);
}

// Gzip all files in the out directory
async function gzipFiles(dir) {
  let gzippedCount = 0;

  const outGzippedDir = path.join(__dirname, '../out-gzipped');

  // Create out-gzipped directory if it doesn't exist
  if (!fs.existsSync(outGzippedDir)) {
    fs.mkdirSync(outGzippedDir, { recursive: true });
  }

  async function walkDir(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walkDir(fullPath);
      } else if (entry.isFile()) {
        // Calculate relative path from out directory
        const relativePath = path.relative(dir, fullPath);

        // Skip already gzipped files
        if (entry.name.endsWith('.gz')) {
          continue;
        }

        // Gzip the file
        try {
          const content = fs.readFileSync(fullPath);
          const gzipped = await gzip(content);
          const gzippedPath = path.join(outGzippedDir, `${relativePath}.gz`);

          // Ensure the directory exists in out-gzipped
          const gzippedDir = path.dirname(gzippedPath);
          if (!fs.existsSync(gzippedDir)) {
            fs.mkdirSync(gzippedDir, { recursive: true });
          }

          fs.writeFileSync(gzippedPath, gzipped);
          gzippedCount++;
        } catch (error) {
          console.error(
            `Failed to gzip ${path.relative(outDir, fullPath)}:`,
            error.message,
          );
        }
      }
    }
  }

  await walkDir(dir);
  console.log(
    `Processed ${gzippedCount} gzipped file(s) and saved to out-gzipped`,
  );
}

// Execute cleanup and optimization
if (fs.existsSync(outDir)) {
  removeNonEssentialFiles(outDir);
  gzipFiles(outDir).catch(error => {
    console.error('Error during gzip process:', error);
    process.exit(1);
  });
} else {
  console.log('Out directory does not exist, skipping cleanup');
}
