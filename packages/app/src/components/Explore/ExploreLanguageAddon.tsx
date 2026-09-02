import { Tooltip, UnstyledButton } from '@mantine/core';
import { IconFilterSearch } from '@tabler/icons-react';

import type { QueryLanguage } from './queryModeSafety';

import styles from './QueryEditor.module.scss';

/**
 * Marks the field as the thing that narrows results, in the left addon — the
 * same slot `SQLInlineEditor` uses for its `SELECT` / `ORDER BY` labels.
 *
 * An icon rather than the word `WHERE`, because the clause name only means
 * something once you know the query it belongs to. Filtering rather than
 * searching, because the field narrows rows instead of finding one, and what
 * you type here is promoted into filter pills by `promoteWhereToFilters`.
 *
 * The combined glyph rather than a plain funnel, though, because a bare
 * `IconFilter` is a verb elsewhere in the app — paired with `IconFilterX` it
 * means "filter by this value" in the result pills, table cells, JSON viewer
 * and comparison charts. Reusing it here would promise a click that applies a
 * filter, when this one opens the syntax reference.
 *
 * That reference is also why the addon is a button and the row needs no
 * separate help icon; which language it documents is left to the placeholder.
 *
 * When a source kind eventually needs a different expression language (metric
 * sources and PromQL), this is where that choice belongs: PromQL replaces the
 * whole query rather than filtering one, so it is a different `configType`, not
 * a different WHERE — the addon becomes a switch, and the pills, Add filter and
 * query editor toggle hide behind it.
 */
export function ExploreLanguageAddon({
  language,
  onOpenSyntaxReference,
}: {
  language: QueryLanguage;
  onOpenSyntaxReference: () => void;
}) {
  return (
    <Tooltip
      label={`Filter syntax — ${language === 'sql' ? 'SQL WHERE' : 'Lucene'} reference`}
      fz="xs"
      color="gray"
      withArrow
    >
      <UnstyledButton
        className={styles.addon}
        onClick={onOpenSyntaxReference}
        aria-label="Open syntax reference"
        data-testid="query-language-addon"
      >
        <IconFilterSearch size={16} />
      </UnstyledButton>
    </Tooltip>
  );
}
