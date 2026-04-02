/**
 * Must be the very first import in cli.tsx so it runs before
 * any common-utils code calls console.debug/warn/error.
 *
 * Exports the original methods for use in non-TUI commands
 * (e.g. auth, sources) that write directly to stderr.
 */

export const _origDebug = console.debug;
export const _origWarn = console.warn;
export const _origError = console.error;

console.debug = () => {};
console.warn = () => {};
console.error = () => {};
