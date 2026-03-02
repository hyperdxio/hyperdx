import * as React from 'react';
import {
  ActionIcon,
  Button,
  Checkbox,
  CloseButton,
  Group,
  Input,
  Popover,
  ScrollArea,
  Stack,
} from '@mantine/core';
import { IconSearch, IconTags } from '@tabler/icons-react';

import api from '@/api';

import styles from './Tags.module.scss';

export const Tags = React.memo(
  ({
    values,
    onChange,
    allowCreate,
    children,
  }: {
    values: string[];
    onChange: (value: string[]) => void;
    allowCreate?: boolean;
    children?: React.ReactNode;
  }) => {
    const {
      data: prefetchedOptionsData,
      isLoading,
      isError,
      refetch,
    } = api.useTags();

    const tags = React.useMemo(() => {
      // Use a case-insensitive Set by creating a Map with lowercase keys
      const tagMap = new Map();

      // Combine values and prefetched data
      [...values, ...(prefetchedOptionsData?.data || [])].forEach(tag => {
        // Use lowercase version as key to ensure case insensitivity
        tagMap.set(tag.toLowerCase(), tag);
      });

      // Convert back to array and sort
      return Array.from(tagMap.values()).sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase()),
      );
    }, [prefetchedOptionsData, values]);

    const [q, setQ] = React.useState('');

    const filtered = React.useMemo(
      () => tags.filter(tag => tag.toLowerCase().includes(q.toLowerCase())),
      [tags, q],
    );

    const handleClearAll = React.useCallback(() => {
      onChange([]);
    }, [onChange]);

    const handleSearchKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          if (allowCreate && q.length > 0) {
            // Check if tag already exists (case insensitive)
            const newTag = event.currentTarget.value;
            const tagExists = values.some(
              tag => tag.toLowerCase() === newTag.toLowerCase(),
            );

            if (!tagExists) {
              onChange([...values, newTag]);
              setQ('');
            }
          }
        }
      },
      [allowCreate, q, onChange, values],
    );

    return (
      <Popover
        withinPortal
        width={240}
        keepMounted={false}
        shadow="xl"
        onOpen={() => {
          refetch(); // todo: better to use queryClient.invalidateQueries('tags')
          setQ('');
        }}
        position="bottom-start"
      >
        <Popover.Target>
          {children || (
            <ActionIcon
              variant="secondary"
              size="sm"
              style={{ cursor: 'pointer' }}
            >
              <IconTags size={14} />
            </ActionIcon>
          )}
        </Popover.Target>
        <Popover.Dropdown p={0}>
          {isLoading && 'Loading'}
          {isError && 'Error'}
          <Input
            size="xs"
            placeholder={allowCreate ? 'Search or create tag' : 'Search tag'}
            variant="filled"
            leftSection={<IconSearch size={16} />}
            autoFocus
            m={8}
            mb={0}
            value={q}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setQ(event.currentTarget.value)
            }
            onKeyDown={handleSearchKeyDown}
            rightSection={
              q && (
                <CloseButton size="xs" radius="xl" onClick={() => setQ('')} />
              )
            }
          />
          <ScrollArea viewportProps={{ style: { maxHeight: 200 } }}>
            {filtered.length === 0 && (
              <div className="pt-3 px-4 fs-8 text-center">
                {allowCreate ? (
                  <>
                    Type and press <span>Enter</span> to create new tag
                  </>
                ) : (
                  'No tags found'
                )}
              </div>
            )}
            <Checkbox.Group
              value={values}
              onChange={onChange}
              size="xs"
              my="sm"
            >
              <Stack gap={4}>
                {filtered.map(tag => (
                  <Group
                    key={tag}
                    justify="space-between"
                    className={styles.tagWrapper}
                  >
                    <Checkbox label={tag.toUpperCase()} value={tag} size="xs" />
                    {tags.length >= 2 && (
                      <Button
                        variant="secondary"
                        size="compact-xs"
                        fw="normal"
                        onClick={() => {
                          onChange([tag]);
                        }}
                      >
                        Only
                      </Button>
                    )}
                  </Group>
                ))}
              </Stack>
            </Checkbox.Group>
          </ScrollArea>
          <div className="p-2 border-top border-dark d-flex justify-content-between align-items-center">
            <div className="ms-2 fs-8 ">{values.length || 'None'} selected</div>
            {values.length >= 1 && (
              <Button
                variant="secondary"
                size="compact-xs"
                fw="normal"
                onClick={handleClearAll}
              >
                Clear all
              </Button>
            )}
          </div>
        </Popover.Dropdown>
      </Popover>
    );
  },
);
