import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { SavedSearchListApiResponse } from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Breadcrumbs,
  Button,
  Group,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconTags } from '@tabler/icons-react';

import { FavoriteButton } from '@/components/FavoriteButton';
import SearchPageActionBar from '@/components/SearchPageActionBar';
import { Tags } from '@/components/Tags';
import { EditablePageName } from '@/EditablePageName';
import { FormatTime } from '@/useFormatTime';

type SavedSearchHeaderProps = {
  savedSearch: SavedSearchListApiResponse;
  onRename: (name: string) => void;
  onUpdateTags: (tags: string[]) => void;
  onDeleteSavedSearch: () => void;
  onSaveAsNew: () => void;
};

export function SavedSearchHeader({
  savedSearch,
  onRename,
  onUpdateTags,
  onDeleteSavedSearch,
  onSaveAsNew,
}: SavedSearchHeaderProps) {
  return (
    <Stack mt="lg" mx="xs">
      <Group justify="space-between">
        <Breadcrumbs fz="sm">
          <Anchor component={Link} href="/search/list" fz="sm" c="dimmed">
            Saved Searches
          </Anchor>
          <Text fz="sm" c="dimmed" maw={400} truncate="end">
            {savedSearch.name}
          </Text>
        </Breadcrumbs>
        <Text size="xs" c="dimmed" lh={1}>
          {savedSearch.createdBy && (
            <span>
              Created by{' '}
              {savedSearch.createdBy.name || savedSearch.createdBy.email}.{' '}
            </span>
          )}
          {savedSearch.updatedAt && (
            <Tooltip
              label={
                <>
                  <FormatTime value={savedSearch.updatedAt} format="short" />
                  {savedSearch.updatedBy
                    ? ` by ${savedSearch.updatedBy.name || savedSearch.updatedBy.email}`
                    : ''}
                </>
              }
            >
              <span>{`Updated ${formatDistanceToNow(new Date(savedSearch.updatedAt), { addSuffix: true })}.`}</span>
            </Tooltip>
          )}
        </Text>
      </Group>
      <Group justify="space-between" align="flex-end">
        <div data-testid="saved-search-name">
          <EditablePageName
            key={savedSearch.id}
            name={savedSearch?.name ?? 'Untitled Search'}
            onSave={onRename}
          />
        </div>

        <Group gap="xs">
          <FavoriteButton
            resourceType="savedSearch"
            resourceId={savedSearch.id}
          />
          <Tags
            allowCreate
            values={savedSearch.tags || []}
            onChange={onUpdateTags}
          >
            <Button
              data-testid="tags-button"
              variant="secondary"
              size="xs"
              style={{ flexShrink: 0 }}
            >
              <IconTags size={14} className="me-1" />
              {savedSearch.tags?.length || 0}
            </Button>
          </Tags>

          <SearchPageActionBar
            onClickDeleteSavedSearch={onDeleteSavedSearch}
            onClickSaveAsNew={onSaveAsNew}
          />
        </Group>
      </Group>
    </Stack>
  );
}
