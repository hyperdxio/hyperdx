const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../out');
const PYODIDE_PATH = path.join(OUT_DIR, 'pyodide');
const ALLOWED_EXTENSIONS = [
  '.html',
  '.js',
  '.css',
  '.map',
  '.woff2',
  '.png',
  '.svg',
  '.ico',
];

// removes pyodide from a next static build. We want a small bundle size, so that feature would just be ignored
if (fs.existsSync(PYODIDE_PATH)) {
  fs.rmSync(PYODIDE_PATH, { recursive: true, force: true });
  console.log('Removed pyodide from static build');
}

// Remove all files that are not in ALLOWED_EXTENSIONS
function removeNonEssentialFiles(dir) {
  let removedCount = 0;

  function walkDir(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          fs.unlinkSync(fullPath);
          console.log(
            `Removed non-essential file: ${path.relative(OUT_DIR, fullPath)}`,
          );
          removedCount++;
        }
      }
    }
  }

  walkDir(dir);
  console.log(`Removed ${removedCount} non-essential file(s)`);
}

// Execute cleanup and optimization
if (fs.existsSync(OUT_DIR)) {
  removeNonEssentialFiles(OUT_DIR);
} else {
  console.error('No out directory found. Build preparation failed.');
  process.exit(1);
}
