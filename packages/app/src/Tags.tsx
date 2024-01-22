import * as React from 'react';
import {
  ActionIcon,
  Button,
  Checkbox,
  CloseButton,
  Group,
  HoverCard,
  Input,
  ScrollArea,
  Stack,
} from '@mantine/core';

import api from './api';

import styles from '../styles/Tags.module.scss';

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
      return Array.from(
        new Set([...values, ...(prefetchedOptionsData?.data || [])]),
      );
    }, [prefetchedOptionsData, values]);

    const [q, setQ] = React.useState('');

    const filtered = React.useMemo(
      () => tags.filter(tag => tag.includes(q)),
      [tags, q],
    );

    const handleClearAll = React.useCallback(() => {
      onChange([]);
    }, [onChange]);

    const handleSearchKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          if (allowCreate && q.length > 0) {
            onChange([...values, event.currentTarget.value]);
            setQ('');
          }
        }
      },
      [allowCreate, q, onChange, values],
    );

    return (
      <HoverCard
        withinPortal
        width={240}
        keepMounted={false}
        shadow="xl"
        onOpen={() => {
          refetch(); // todo: better to use queryClient.invalidateQueries('tags')
          setQ('');
        }}
        withArrow
      >
        <HoverCard.Target>
          {children || (
            <ActionIcon
              variant="filled"
              size="sm"
              color="gray"
              sx={{ cursor: 'pointer' }}
            >
              <i className="bi bi-tags text-slate-300 fs-7" />
            </ActionIcon>
          )}
        </HoverCard.Target>
        <HoverCard.Dropdown p={0} bg="dark">
          {isLoading && 'Loading'}
          {isError && 'Error'}
          <Input
            size="xs"
            placeholder={allowCreate ? 'Search or create tag' : 'Search tag'}
            variant="filled"
            icon={<i className="bi bi-search" />}
            autoFocus
            m={8}
            mb={0}
            value={q}
            onChange={event => setQ(event.currentTarget.value)}
            onKeyDown={handleSearchKeyDown}
            rightSection={
              q && (
                <CloseButton size="xs" radius="xl" onClick={() => setQ('')} />
              )
            }
          />
          <ScrollArea viewportProps={{ style: { maxHeight: 200 } }}>
            {filtered.length === 0 && (
              <div className="pt-3 px-4 fs-8 text-slate-400 text-center">
                {allowCreate ? (
                  <>
                    Type and press <span className="text-slate-300">Enter</span>{' '}
                    to create new tag
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
              <Stack spacing={4}>
                {filtered.map(tag => (
                  <Group
                    key={tag}
                    position="apart"
                    className={styles.tagWrapper}
                  >
                    <Checkbox label={tag} value={tag} />
                    {tags.length >= 2 && (
                      <Button
                        variant="filled"
                        color="gray"
                        size="xs"
                        compact
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
            <div className="ms-2 fs-8 text-slate-400">
              {values.length || 'None'} selected
            </div>
            {values.length > 1 && (
              <Button
                variant="default"
                size="xs"
                compact
                fw="normal"
                onClick={handleClearAll}
              >
                Clear all
              </Button>
            )}
          </div>
        </HoverCard.Dropdown>
      </HoverCard>
    );
  },
);
