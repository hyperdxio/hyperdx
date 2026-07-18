import { TSource } from '@hyperdx/common-utils/dist/types';

/**
 * Distinct, trimmed, non-empty section names across the given sources, sorted
 * alphabetically. Feeds the Section autocomplete in the source form so a new
 * source can reuse an existing section name rather than retyping it (which is
 * how "Billing" and "billing" end up as two separate groups in the selector).
 * The field stays free-text; these are only suggestions, matched by exact
 * string so the suggested casing is the one that groups consistently.
 */
export function distinctSections(sources: TSource[] | undefined): string[] {
  const sections = new Set<string>();
  for (const source of sources ?? []) {
    const section = source.section?.trim();
    if (section) {
      sections.add(section);
    }
  }
  return [...sections].sort((a, b) => a.localeCompare(b));
}
