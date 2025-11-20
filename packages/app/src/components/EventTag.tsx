import { useState } from 'react';
import Link from 'next/link';
import SqlString from 'sqlstring';
import { SearchConditionLanguage } from '@hyperdx/common-utils/dist/types';
import { Button, Popover, Stack, Tooltip } from '@mantine/core';
import { IconLink } from '@tabler/icons-react';

import { isLinkableUrl } from '@/utils/highlightedAttributes';

export default function EventTag({
  displayedKey,
  name,
  nameLanguage = 'lucene',
  sqlExpression,
  value,
  onPropertyAddClick,
  generateSearchUrl,
}: {
  displayedKey?: string;
  /** Property name, in lucene or sql syntax (ex. col.prop or col['prop']) */
  name: string;
  /** The language of the property name, defaults to 'lucene' */
  nameLanguage?: SearchConditionLanguage;
  value: string;
  generateSearchUrl?: (
    query?: string,
    queryLanguage?: SearchConditionLanguage,
  ) => string;
} & (
  | {
      sqlExpression: undefined;
      onPropertyAddClick: undefined;
    }
  | {
      sqlExpression: string; // sql expression ex. col['prop']
      onPropertyAddClick: (key: string, value: string) => void;
    }
)) {
  const [opened, setOpened] = useState(false);
  const isLink = isLinkableUrl(value);
  const hasActions = !!onPropertyAddClick || !!generateSearchUrl || isLink;

  if (!hasActions) {
    return (
      <div key={name} className="bg-highlighted px-2 py-0.5 me-1 my-1">
        {displayedKey || name}: {value}
      </div>
    );
  }

  const searchCondition =
    nameLanguage === 'sql'
      ? SqlString.format('? = ?', [SqlString.raw(name), value])
      : `${name}:${typeof value === 'string' ? `"${value}"` : value}`;

  return (
    <Popover
      position="top"
      withinPortal={false}
      withArrow
      opened={opened}
      onChange={setOpened}
    >
      <Popover.Target>
        {isLink ? (
          <Tooltip
            label={value}
            withArrow
            maw={400}
            multiline
            style={{ wordBreak: 'break-word' }}
          >
            <a
              href={encodeURI(value)}
              target="_blank"
              rel="noopener noreferrer"
              className="d-flex flex-row align-items-center bg-highlighted px-2 py-0.5 me-1 my-1 cursor-pointer"
            >
              {displayedKey || name}
              <IconLink size={14} className="ms-1" />
            </a>
          </Tooltip>
        ) : (
          <div
            className="bg-highlighted px-2 py-0.5 me-1 my-1 cursor-pointer"
            onClick={() => setOpened(!opened)}
          >
            {displayedKey || name}: {value}
          </div>
        )}
      </Popover.Target>
      <Popover.Dropdown p={2}>
        <Stack gap={0} justify="stretch">
          {onPropertyAddClick && (
            <Button
              justify="space-between"
              color="gray"
              variant="subtle"
              size="xs"
              rightSection={<i className="bi bi-plus-circle" />}
              onClick={() => {
                onPropertyAddClick(sqlExpression, value);
                setOpened(false);
              }}
            >
              Add to Search
            </Button>
          )}
          {generateSearchUrl && (
            <Link
              href={generateSearchUrl(searchCondition, nameLanguage)}
              passHref
              legacyBehavior
            >
              <Button
                justify="space-between"
                color="gray"
                variant="subtle"
                size="xs"
                rightSection={<i className="bi bi-search" />}
              >
                Search This Value
              </Button>
            </Link>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
