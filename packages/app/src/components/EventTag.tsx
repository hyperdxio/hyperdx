import { useState } from 'react';
import Link from 'next/link';
import { Button, Popover, Stack } from '@mantine/core';

export default function EventTag({
  displayedKey,
  name,
  value,
  onPropertyAddClick,
  generateSearchUrl,
}: {
  displayedKey?: string;
  name: string;
  value: string;
  onPropertyAddClick?: (key: string, value: string) => void;
  generateSearchUrl: (query?: string, timeRange?: [Date, Date]) => string;
}) {
  const [opened, setOpened] = useState(false);

  return (
    <Popover
      position="top"
      withinPortal={false}
      withArrow
      opened={opened}
      onChange={setOpened}
    >
      <Popover.Target>
        <div
          key={name}
          className="text-muted-hover bg-hdx-dark px-2 py-0.5 me-1 my-1 cursor-pointer"
          onClick={() => setOpened(!opened)}
        >
          {displayedKey || name}
          {': '}
          {value}
        </div>
      </Popover.Target>
      <Popover.Dropdown p={2}>
        <Stack gap={0} justify="stretch">
          {onPropertyAddClick ? (
            <Button
              justify="space-between"
              color="gray"
              variant="subtle"
              size="xs"
              rightSection={<i className="bi bi-plus-circle" />}
              onClick={() => {
                onPropertyAddClick(name, value);
                setOpened(false);
              }}
            >
              Add to Search
            </Button>
          ) : null}
          <Link
            href={generateSearchUrl(
              `${name}:${typeof value === 'string' ? `"${value}"` : value}`,
            )}
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
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
