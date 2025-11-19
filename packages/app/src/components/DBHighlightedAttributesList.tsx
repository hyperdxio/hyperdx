import { useContext, useMemo } from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Flex } from '@mantine/core';

import { RowSidePanelContext } from './DBRowSidePanel';
import EventTag from './EventTag';

export type HighlightedAttribute = {
  source: TSource;
  displayedKey: string;
  value: string;
  sql: string;
  lucene?: string;
};

export function DBHighlightedAttributesList({
  attributes = [],
}: {
  attributes: HighlightedAttribute[];
}) {
  const {
    onPropertyAddClick,
    generateSearchUrl,
    source: contextSource,
  } = useContext(RowSidePanelContext);

  const sortedAttributes = useMemo(() => {
    return attributes.sort(
      (a, b) =>
        a.displayedKey.localeCompare(b.displayedKey) ||
        a.value.localeCompare(b.value),
    );
  }, [attributes]);

  return (
    <Flex wrap="wrap" gap="2px" mb="md">
      {sortedAttributes.map(({ displayedKey, value, sql, lucene, source }) => (
        <EventTag
          displayedKey={displayedKey}
          name={lucene ? lucene : sql}
          nameLanguage={lucene ? 'lucene' : 'sql'}
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
                  })
              : undefined
          }
        />
      ))}
    </Flex>
  );
}
