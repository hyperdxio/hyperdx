import { use, useMemo, useState } from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Anchor, Flex } from '@mantine/core';

import { RowSidePanelContext } from './DBRowSidePanel';
import EventTag from './EventTag';

const DEFAULT_ATTRIBUTES_TO_SHOW = 12;

export type HighlightedAttribute = {
  source: TSource;
  displayedKey: string;
  value: string;
  sql: string;
  lucene?: string;
};

export function DBHighlightedAttributesList({
  attributes,
  pivotToAttributeSource = false,
}: {
  attributes: HighlightedAttribute[];
  /**
   * Search actions open the attribute's own source rather than narrowing the
   * current search with a correlated condition on it.
   */
  pivotToAttributeSource?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const {
    onPropertyAddClick,
    generateSearchUrl,
    source: contextSource,
  } = use(RowSidePanelContext);

  const sortedAttributes = useMemo(() => {
    return attributes
      .sort(
        (a, b) =>
          a.displayedKey.localeCompare(b.displayedKey) ||
          a.value.localeCompare(b.value),
      )
      .slice(0, isExpanded ? attributes.length : DEFAULT_ATTRIBUTES_TO_SHOW);
  }, [attributes, isExpanded]);

  const hiddenAttributesCount = attributes.length - sortedAttributes.length;

  return (
    <Flex wrap="wrap" gap="2px" mb="md" align="baseline">
      {sortedAttributes.map(({ displayedKey, value, sql, lucene, source }) => {
        // A cross-source attribute's condition is composed into raw SQL
        // against its source's table, so emit the SQL form — lucene text
        // can't be embedded in SQL. Same-source attributes — and pivoting
        // searches, which run against the attribute's own source — prefer
        // lucene when available.
        const useLucene =
          !!lucene &&
          (pivotToAttributeSource ||
            contextSource == null ||
            contextSource.id === source.id);
        return (
          <EventTag
            displayedKey={displayedKey}
            name={useLucene ? lucene : sql}
            nameLanguage={useLucene ? 'lucene' : 'sql'}
            value={value}
            key={`${displayedKey}-${value}-${source.id}`}
            {...(onPropertyAddClick && contextSource?.id === source.id
              ? {
                  onPropertyAddClick,
                  sqlExpression: sql,
                }
              : {
                  onPropertyAddClick: undefined,
                  sqlExpression: undefined,
                })}
            generateSearchUrl={
              generateSearchUrl
                ? (query, queryLanguage) =>
                    generateSearchUrl({
                      where: query || '',
                      whereLanguage: queryLanguage ?? 'lucene',
                      source,
                      pivot: pivotToAttributeSource,
                    })
                : undefined
            }
          />
        );
      })}
      {attributes.length > DEFAULT_ATTRIBUTES_TO_SHOW && (
        <Anchor size="xs" onClick={() => setIsExpanded(!isExpanded)}>
          {isExpanded ? 'Show Less' : `Show ${hiddenAttributesCount} More...`}
        </Anchor>
      )}
    </Flex>
  );
}
