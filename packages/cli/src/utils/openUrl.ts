import { exec } from 'child_process';

/**
 * Open a URL in the user's default browser.
 *
 * Uses platform-specific commands:
 *  - macOS:   `open <url>`
 *  - Linux:   `xdg-open <url>`
 *  - Windows: `start "" "<url>"`
 *
 * Fire-and-forget — errors are silently ignored so the TUI
 * is never disrupted if the browser fails to launch.
 */
export function openUrl(url: string): void {
  const platform = process.platform;
  let cmd: string;

  if (platform === 'darwin') {
    cmd = `open ${JSON.stringify(url)}`;
  } else if (platform === 'win32') {
    cmd = `start "" ${JSON.stringify(url)}`;
  } else {
    // Linux and other Unix-like systems
    cmd = `xdg-open ${JSON.stringify(url)}`;
  }

  exec(cmd, () => {
    // Intentionally swallow errors — headless servers, missing
    // display, etc. should not crash the TUI.
  });
}
