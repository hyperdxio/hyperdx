import { AlertState } from '@hyperdx/common-utils/dist/types';
import { Badge, Button, Flex, Group, Menu, Text } from '@mantine/core';
import {
  IconBell,
  IconBookmarks,
  IconCheck,
  IconChevronDown,
  IconPlus,
  IconSettings,
} from '@tabler/icons-react';

import SearchPageActionBar from '@/components/SearchPageActionBar';

type AlertLike = { state?: AlertState };

function alertBellColor(alerts?: AlertLike[]): string | undefined {
  if (alerts?.some(a => a.state === AlertState.ALERT)) {
    return 'var(--mantine-color-red-filled)';
  }
  if (alerts?.some(a => a.state === AlertState.PENDING)) {
    return 'var(--mantine-color-orange-filled)';
  }
  return undefined;
}

function SaveStatusPill({
  savedSearchId,
  isDirty,
}: {
  savedSearchId?: string | null;
  isDirty: boolean;
}) {
  if (!savedSearchId) {
    return (
      <Badge
        variant="outline"
        color="gray"
        size="sm"
        radius="sm"
        data-testid="save-status-pill"
      >
        Unsaved
      </Badge>
    );
  }
  if (isDirty) {
    return (
      <Badge
        variant="light"
        color="yellow"
        size="sm"
        radius="sm"
        data-testid="save-status-pill"
      >
        edited
      </Badge>
    );
  }
  return (
    <Badge
      variant="light"
      color="green"
      size="sm"
      radius="sm"
      leftSection={<IconCheck size={12} />}
      data-testid="save-status-pill"
    >
      Saved
    </Badge>
  );
}

function AlertsControl({
  savedSearchId,
  alerts,
  onOpenAlert,
}: {
  savedSearchId?: string | null;
  alerts?: AlertLike[];
  onOpenAlert: () => void;
}) {
  if (!savedSearchId) {
    return (
      <Button
        data-testid="alerts-button"
        variant="secondary"
        size="xs"
        leftSection={<IconBell size={14} />}
        rightSection={<IconChevronDown size={12} />}
        disabled
        title="Save this view to add alerts"
        style={{ flexShrink: 0 }}
      >
        Alerts
      </Button>
    );
  }

  const hasAlerts = alerts != null && alerts.length > 0;

  return (
    <Menu position="bottom-end" withinPortal width={220}>
      <Menu.Target>
        <Button
          data-testid="alerts-button"
          variant="secondary"
          size="xs"
          leftSection={<IconBell size={14} color={alertBellColor(alerts)} />}
          rightSection={<IconChevronDown size={12} />}
          style={{ flexShrink: 0 }}
        >
          Alerts
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {hasAlerts && (
          <Menu.Label>
            {alerts!.length} alert{alerts!.length > 1 ? 's' : ''} configured
          </Menu.Label>
        )}
        <Menu.Item leftSection={<IconPlus size={16} />} onClick={onOpenAlert}>
          Create alert&hellip;
        </Menu.Item>
        {hasAlerts && (
          <Menu.Item
            leftSection={<IconSettings size={16} />}
            onClick={onOpenAlert}
          >
            Manage alerts
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * Context band for the Explore page: source selector, saved-view selector,
 * save-status pill, contextual save actions, alerts, and an overflow menu.
 * Presentational: all data/handlers are passed in from the page.
 */
export function ExploreContextBand({
  sourceSelect,
  savedSearchId,
  savedSearchName,
  isDirty,
  isLocalMode,
  alerts,
  onOpenSavedViews,
  onSaveView,
  onUpdate,
  onSaveAsNew,
  onOpenAlert,
  onDelete,
}: {
  /** Rendered source selector (kept in the page so it stays form-controlled). */
  sourceSelect: React.ReactNode;
  savedSearchId?: string | null;
  savedSearchName?: string;
  isDirty: boolean;
  isLocalMode: boolean;
  alerts?: AlertLike[];
  onOpenSavedViews: () => void;
  onSaveView: () => void;
  onUpdate: () => void;
  onSaveAsNew: () => void;
  onOpenAlert: () => void;
  onDelete: () => void;
}) {
  return (
    <Flex
      gap="sm"
      px="sm"
      pt="sm"
      align="center"
      wrap="wrap"
      data-testid="explore-context-band"
    >
      {sourceSelect}
      <Button
        data-testid="saved-views-button"
        variant="secondary"
        size="xs"
        leftSection={<IconBookmarks size={14} />}
        rightSection={<IconChevronDown size={12} />}
        onClick={onOpenSavedViews}
        style={{ flexShrink: 0, maxWidth: 240 }}
      >
        <Text size="xs" truncate="end">
          {savedSearchName ?? 'Saved views'}
        </Text>
      </Button>
      <SaveStatusPill savedSearchId={savedSearchId} isDirty={isDirty} />
      <Group gap="sm" ml="auto" wrap="nowrap">
        {!savedSearchId ? (
          <Button
            data-testid="save-view-button"
            variant="primary"
            size="xs"
            onClick={onSaveView}
            style={{ flexShrink: 0 }}
          >
            Save view
          </Button>
        ) : isDirty ? (
          <>
            <Button
              data-testid="save-view-button"
              variant="primary"
              size="xs"
              onClick={onUpdate}
              style={{ flexShrink: 0 }}
            >
              Save
            </Button>
            <Button
              data-testid="save-as-button"
              variant="secondary"
              size="xs"
              onClick={onSaveAsNew}
              style={{ flexShrink: 0 }}
            >
              Save as&hellip;
            </Button>
          </>
        ) : null}
        {!isLocalMode && (
          <AlertsControl
            savedSearchId={savedSearchId}
            alerts={alerts}
            onOpenAlert={onOpenAlert}
          />
        )}
        {savedSearchId && (
          <SearchPageActionBar
            onClickDeleteSavedSearch={onDelete}
            onClickSaveAsNew={onSaveAsNew}
          />
        )}
      </Group>
    </Flex>
  );
}
