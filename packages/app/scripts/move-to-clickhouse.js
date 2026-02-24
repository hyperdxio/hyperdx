const fs = require('fs');
const path = require('path');

// Move out-gzipped to replace ClickHouse clickstack directory
function moveToClickHouse() {
  const outGzippedDir = path.join(__dirname, '../out-gzipped');
  const clickStackDir = path.join(
    __dirname,
    '../../../../ClickHouse/programs/server/clickstack',
  );

  if (!fs.existsSync(outGzippedDir)) {
    console.error('Error: out-gzipped directory does not exist');
    console.error('Run build:clickhouse first to generate the build');
    process.exit(1);
  }

  const clickStackParentDir = path.dirname(clickStackDir);
  if (!fs.existsSync(clickStackParentDir)) {
    console.error(
      `Error: ClickHouse server directory does not exist at ${clickStackParentDir}`,
    );
    console.error(
      'Make sure the ClickHouse repository is cloned at ../ClickHouse',
    );
    process.exit(1);
  }

  // Remove existing clickstack directory if it exists
  if (fs.existsSync(clickStackDir)) {
    console.log('Removing existing clickstack directory...');
    fs.rmSync(clickStackDir, { recursive: true, force: true });
  }

  // Copy out-gzipped to clickstack
  console.log(`Moving out-gzipped to ${clickStackDir}...`);
  fs.cpSync(outGzippedDir, clickStackDir, { recursive: true });
  console.log('✓ Successfully moved build to ClickHouse clickstack directory');
}

moveToClickHouse();
