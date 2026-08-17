import type { MacroName } from './macros';

/** Thrown for an unterminated macro argument list, e.g. `$__timeFilter(col`. */
export class MalformedMacroArgsError extends Error {
  constructor() {
    super('Failed to parse macro arguments');
    this.name = 'MalformedMacroArgsError';
  }
}

/** Thrown when a macro cannot expand, tagged with the macro it came. */
export class MacroExpansionError extends Error {
  constructor(
    public readonly macro: MacroName,
    message: string,
  ) {
    super(message);
    this.name = 'MacroExpansionError';
  }
}
