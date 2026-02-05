const fs = require('fs');
const path = require('path');

// removes pyodide from a next static build. We want a small bundle size, so that feature would just be ignored
const pyodidePath = path.join(__dirname, '../out/pyodide');
if (fs.existsSync(pyodidePath)) {
  fs.rmSync(pyodidePath, { recursive: true, force: true });
  console.log('Removed pyodide from static build');
}
