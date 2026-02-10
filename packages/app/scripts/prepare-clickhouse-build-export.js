const fs = require('fs');
const path = require('path');

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

// Execute cleanup and optimization
if (fs.existsSync(outDir)) {
  removeNonEssentialFiles(outDir);
} else {
  console.error('No out directory found. Build preparation failed.');
  process.exit(1);
}
