import { useState } from 'react';
import { DashboardContainer } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Flex,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconPencil, IconTrash } from '@tabler/icons-react';

function AlertDot({ size = 6 }: { size?: number }) {
  return (
    <Flex
      component="span"
      display="inline-block"
      w={size}
      h={size}
      style={{
        borderRadius: '50%',
        backgroundColor: 'var(--color-bg-danger)',
        flexShrink: 0,
      }}
    />
  );
}

export { AlertDot };

type GroupTabBarProps = {
  tabs: NonNullable<DashboardContainer['tabs']>;
  activeTabId: string | undefined;
  showControls: boolean;
  onTabChange?: (tabId: string) => void;
  onRenameTab?: (tabId: string, newTitle: string) => void;
  onDeleteTab?: (tabId: string) => void;
  containerId: string;
  alertingTabIds?: Set<string>;
  confirm?: (
    message: React.ReactNode,
    confirmLabel?: string,
    options?: { variant?: 'primary' | 'danger' },
  ) => Promise<boolean>;
  hoverControlStyle: React.CSSProperties;
};

export default function GroupTabBar({
  tabs,
  activeTabId,
  showControls,
  onTabChange,
  onRenameTab,
  onDeleteTab,
  containerId,
  alertingTabIds,
  confirm,
  hoverControlStyle,
}: GroupTabBarProps) {
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [tabRenameValue, setTabRenameValue] = useState('');
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);

  const handleCommitTabRename = (tabId: string) => {
    const trimmed = tabRenameValue.trim();
    const tab = tabs.find(t => t.id === tabId);
    if (trimmed && tab && trimmed !== tab.title) {
      onRenameTab?.(tabId, trimmed);
    }
    setRenamingTabId(null);
  };

  const handleDeleteTab = async (tabId: string) => {
    if (confirm) {
      const tab = tabs.find(t => t.id === tabId);
      const confirmed = await confirm(
        <>
          Delete tab{' '}
          <Text component="span" fw={700}>
            {tab?.title ?? 'this tab'}
          </Text>
          ? Tiles will be moved to the first remaining tab.
        </>,
        'Delete',
        { variant: 'danger' },
      );
      if (!confirmed) return;
    }
    onDeleteTab?.(tabId);
  };

  return (
    <>
      <Tabs.List style={{ flex: 1, border: 'none' }}>
        {tabs.map(tab => (
          <Tabs.Tab
            key={tab.id}
            value={tab.id}
            size="sm"
            onMouseEnter={() => setHoveredTabId(tab.id)}
            onMouseLeave={() => setHoveredTabId(null)}
            rightSection={
              onDeleteTab && tabs.length > 1 ? (
                <ActionIcon
                  variant="subtle"
                  size={16}
                  style={{
                    opacity: hoveredTabId === tab.id ? 1 : 0,
                    transition: 'opacity 150ms',
                  }}
                  onClick={e => {
                    e.stopPropagation();
                    handleDeleteTab(tab.id);
                  }}
                  title="Delete tab"
                  data-testid={`tab-delete-${tab.id}`}
                >
                  <IconTrash size={12} />
                </ActionIcon>
              ) : undefined
            }
            onDoubleClick={
              onRenameTab
                ? () => {
                    setRenamingTabId(tab.id);
                    setTabRenameValue(tab.title);
                  }
                : undefined
            }
          >
            {renamingTabId === tab.id ? (
              <form
                onSubmit={e => {
                  e.preventDefault();
                  handleCommitTabRename(tab.id);
                }}
                onClick={e => e.stopPropagation()}
                style={{ display: 'inline' }}
              >
                <TextInput
                  variant="unstyled"
                  value={tabRenameValue}
                  onChange={e => setTabRenameValue(e.target.value)}
                  onBlur={() => handleCommitTabRename(tab.id)}
                  onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === 'Escape') setRenamingTabId(null);
                  }}
                  autoFocus
                  size="xs"
                  w={`${Math.max(tabRenameValue.length, 3)}ch`}
                  styles={{
                    input: {
                      padding: 0,
                      margin: 0,
                      minHeight: 'auto',
                      height: 'auto',
                      font: 'inherit',
                      color: 'inherit',
                    },
                  }}
                  data-testid={`tab-rename-input-${tab.id}`}
                />
              </form>
            ) : (
              <Flex
                component="span"
                display="inline-flex"
                align="center"
                gap={4}
              >
                {tab.title}
                {alertingTabIds?.has(tab.id) && <AlertDot size={5} />}
              </Flex>
            )}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {/* Rename active tab button */}
      {onRenameTab && activeTabId && (
        <Tooltip label="Rename Tab" position="top" withArrow>
          <ActionIcon
            variant="subtle"
            size="sm"
            tabIndex={showControls ? 0 : -1}
            style={hoverControlStyle}
            onClick={() => {
              const tab = tabs.find(t => t.id === activeTabId);
              if (tab) {
                setRenamingTabId(tab.id);
                setTabRenameValue(tab.title);
              }
            }}
            data-testid={`tab-rename-btn-${containerId}`}
          >
            <IconPencil size={14} />
          </ActionIcon>
        </Tooltip>
      )}
    </>
  );
}
