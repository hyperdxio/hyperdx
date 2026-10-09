import React from 'react';

/**
 * A set of terms sharing one style. Leaving `textColor` unset keeps whatever
 * colour the text already had, which only works over a translucent background.
 */
export type HighlightGroup = {
  terms: string[];
  backgroundColor: string;
  textColor?: string;
};

/** The in-table find box: a solid fill, since it is a deliberate, transient action. */
export const FIND_HIGHLIGHT = {
  backgroundColor: 'var(--color-bg-highlight-find)',
  textColor: 'var(--color-text-highlight-find)',
};
/** The find match the user is currently sitting on. */
export const FIND_CURRENT_HIGHLIGHT = {
  backgroundColor: 'var(--color-bg-highlight-find-current)',
  textColor: 'var(--color-text-highlight-find)',
};
/**
 * The active query's own terms. Same yellow family as the find box, but a wash
 * rather than a solid fill: these are always on and a busy row can carry a
 * dozen of them. No text colour, so a log level keeps its severity colour.
 */
export const QUERY_HIGHLIGHT = {
  backgroundColor: 'var(--color-bg-highlight-query)',
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
  return [...merged, ...accepted.slice(i)];
}

/**
 * Wrap every occurrence of the given terms in a `<mark>`, styled by the group
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
          // `inherit` has to be explicit: the UA stylesheet gives `mark` its
          // own black `color`, which beats inheriting the cell's.
          color: group.textColor ?? 'inherit',
          padding: 0,
        }}
      >
        {text.slice(match.start, match.end)}
      </mark>,
    );
    cursor = match.end;
  }
  parts.push(text.slice(cursor));

  return <>{parts}</>;
};
