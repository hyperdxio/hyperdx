import React from 'react';

/** Terms the user typed into the in-table find box. */
export const FIND_HIGHLIGHT_BACKGROUND = 'var(--mantine-color-yellow-3)';
/** The find match the user is currently sitting on. */
export const FIND_CURRENT_HIGHLIGHT_BACKGROUND =
  'var(--mantine-color-orange-5)';
/** Terms pulled from the active Lucene query, kept distinct from find matches. */
export const QUERY_HIGHLIGHT_BACKGROUND = 'var(--mantine-color-blue-3)';

const DEFAULT_TEXT_COLOR = 'var(--color-text-inverted)';

interface HighlightTextSettings {
  isCurrentMatch: boolean;
  textColor: string;
  backgroundColor: string;
  currentMatchBackgroundColor: string;
}

/** A set of terms sharing one colour. */
export type HighlightGroup = {
  terms: string[];
  backgroundColor: string;
  textColor?: string;
};

type Match = { start: number; end: number; groupIndex: number };

/**
 * Every occurrence of any term in the group, sorted by position with
 * self-overlaps resolved in favour of the longer match.
 */
function findGroupMatches(
  lowerText: string,
  terms: string[],
  groupIndex: number,
): Match[] {
  const found: Match[] = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle.trim()) continue;

    let index = lowerText.indexOf(needle);
    while (index !== -1) {
      found.push({ start: index, end: index + needle.length, groupIndex });
      index = lowerText.indexOf(needle, index + needle.length);
    }
  }

  found.sort((a, b) => a.start - b.start || b.end - a.end);

  const matches: Match[] = [];
  let cursor = 0;
  for (const match of found) {
    if (match.start < cursor) continue;
    matches.push(match);
    cursor = match.end;
  }
  return matches;
}

/**
 * Merge two position-sorted, internally non-overlapping match lists, dropping
 * candidates that collide with an already-accepted match.
 */
function mergeNonOverlapping(accepted: Match[], candidates: Match[]): Match[] {
  const merged: Match[] = [];
  let i = 0;
  for (const candidate of candidates) {
    while (i < accepted.length && accepted[i].end <= candidate.start) {
      merged.push(accepted[i]);
      i++;
    }
    if (!(i < accepted.length && accepted[i].start < candidate.end)) {
      merged.push(candidate);
    }
  }
  while (i < accepted.length) {
    merged.push(accepted[i]);
    i++;
  }
  return merged;
}

/**
 * Wrap every occurrence of the given terms in a `<mark>`, coloured by the group
 * the term came from. Matching is case-insensitive substring matching. Earlier
 * groups win where matches would overlap, so the find box keeps its colour when
 * it lands on top of a query term.
 */
export const highlightTerms = (
  text: string,
  groups: HighlightGroup[],
): React.ReactNode => {
  const lowerText = text.toLowerCase();

  let matches: Match[] = [];
  groups.forEach((group, groupIndex) => {
    matches = mergeNonOverlapping(
      matches,
      findGroupMatches(lowerText, group.terms, groupIndex),
    );
  });

  if (matches.length === 0) {
    return text;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      parts.push(text.slice(cursor, match.start));
    }
    const group = groups[match.groupIndex];
    parts.push(
      <mark
        key={`${match.start}-${match.end}-${match.groupIndex}`}
        style={{
          backgroundColor: group.backgroundColor,
          color: group.textColor || DEFAULT_TEXT_COLOR,
          padding: 0,
        }}
      >
        {text.slice(match.start, match.end)}
      </mark>,
    );
    cursor = match.end;
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return <>{parts}</>;
};

/**
 * Highlight a single find-box query within a cell value.
 *
 * @param text - The text to highlight within
 * @param query - The query to highlight
 * @param settings.isCurrentMatch - Whether this is the match the user is on,
 * which is highlighted with an orange background.
 */
export const highlightText = (
  text: string,
  query: string,
  settings: Partial<HighlightTextSettings> = {},
): React.ReactNode => {
  if (!query.trim()) return text;

  return highlightTerms(text, [
    {
      terms: [query],
      backgroundColor: settings.isCurrentMatch
        ? settings.currentMatchBackgroundColor ||
          FIND_CURRENT_HIGHLIGHT_BACKGROUND
        : settings.backgroundColor || FIND_HIGHLIGHT_BACKGROUND,
      textColor: settings.textColor,
    },
  ]);
};
