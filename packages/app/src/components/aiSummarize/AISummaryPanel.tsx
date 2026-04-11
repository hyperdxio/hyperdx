import { useState } from 'react';
import {
  Anchor,
  Button,
  Collapse,
  Flex,
  Menu,
  Paper,
  Popover,
  Text,
} from '@mantine/core';
import {
  IconChevronDown,
  IconCloudOff,
  IconInfoCircle,
  IconSparkles,
} from '@tabler/icons-react';

import {
  AI_SUMMARY_TONE_LABELS,
  AI_SUMMARY_TONES,
  AISummaryTone,
  isSmartSummaryModeEnabled,
} from './helpers';

export default function AISummaryPanel({
  aiEnabled,
  isOpen,
  isGenerating,
  result,
  onToggle,
  onRegenerate,
  onDismiss,
  onToneChange,
  tone,
  analyzingLabel = 'Analyzing event data...',
}: {
  aiEnabled: boolean;
  isOpen: boolean;
  isGenerating: boolean;
  result: { text: string; tone?: AISummaryTone } | null;
  onToggle: () => void;
  onRegenerate: () => void;
  onDismiss: () => void;
  onToneChange: (tone: AISummaryTone) => void;
  tone: AISummaryTone;
  analyzingLabel?: string;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const isSmartMode = isSmartSummaryModeEnabled();
  const shouldShowUnavailableState = !aiEnabled;

  return (
    <div>
      <Flex align="center" gap={6} mt={6}>
        <Button
          size="compact-xs"
          variant="subtle"
          color="violet"
          onClick={onToggle}
          leftSection={<IconSparkles size={12} />}
        >
          {isOpen ? 'Hide Summary' : 'Summarize'}
        </Button>
        {result && isOpen && (
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={onRegenerate}
          >
            Regenerate
          </Button>
        )}
        {isSmartMode && (
          <Menu withinPortal position="bottom-start">
            <Menu.Target>
              <Anchor
                component="button"
                type="button"
                size="xs"
                c="dimmed"
                style={{
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                Style: {AI_SUMMARY_TONE_LABELS[tone]}
                <IconChevronDown size={12} />
              </Anchor>
            </Menu.Target>
            <Menu.Dropdown>
              {AI_SUMMARY_TONES.map(styleTone => (
                <Menu.Item
                  key={styleTone}
                  onClick={() => onToneChange(styleTone)}
                  fw={styleTone === tone ? 600 : 400}
                >
                  {AI_SUMMARY_TONE_LABELS[styleTone]}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}
        <Anchor
          component="button"
          type="button"
          size="xs"
          c="dimmed"
          onClick={onDismiss}
          style={{ cursor: 'pointer' }}
        >
          Don&apos;t show again
        </Anchor>
      </Flex>
      <Collapse in={isOpen || shouldShowUnavailableState}>
        <Paper
          p="sm"
          mt={6}
          radius="sm"
          style={{
            borderLeft: '3px solid var(--mantine-color-violet-5)',
            whiteSpace: 'pre-line',
            lineHeight: 1.55,
          }}
        >
          {shouldShowUnavailableState ? (
            <>
              <Flex align="center" gap={6} mb={4}>
                <Text size="xs" fw={600} c="orange">
                  <IconCloudOff
                    size={11}
                    style={{
                      display: 'inline',
                      verticalAlign: 'middle',
                      marginRight: 4,
                    }}
                  />
                  AI Summary Not Enabled
                </Text>
              </Flex>
              <Text size="sm" mb={8}>
                AI summary is not enabled for this HyperDX server.
              </Text>
              <Text size="xs" c="dimmed" mb={8}>
                To enable it, configure <code>AI_PROVIDER</code> and{' '}
                <code>AI_API_KEY</code> (or legacy{' '}
                <code>ANTHROPIC_API_KEY</code>) in your API environment, then
                restart the API service.
              </Text>
            </>
          ) : isGenerating ? (
            <Text size="sm" c="dimmed" fs="italic">
              {analyzingLabel}
            </Text>
          ) : (
            <>
              <Flex align="center" gap={6} mb={4}>
                <Text size="xs" fw={600} c="violet">
                  <IconSparkles
                    size={11}
                    style={{
                      display: 'inline',
                      verticalAlign: 'middle',
                      marginRight: 4,
                    }}
                  />
                  AI Summary
                  {result && (
                    <Text span c="dimmed" fw={400} ms={6}>
                      {AI_SUMMARY_TONE_LABELS[result.tone ?? tone]}
                    </Text>
                  )}
                </Text>
                <Popover
                  opened={infoOpen}
                  onChange={setInfoOpen}
                  width={280}
                  withArrow
                  position="top"
                  shadow="sm"
                >
                  <Popover.Target>
                    <IconInfoCircle
                      size={13}
                      onClick={() => setInfoOpen(o => !o)}
                      style={{
                        color: 'var(--mantine-color-dimmed)',
                        cursor: 'help',
                        flexShrink: 0,
                      }}
                    />
                  </Popover.Target>
                  <Popover.Dropdown>
                    <Text size="xs" mb={6}>
                      Summaries are generated by your configured AI provider.
                      Add <code>?smart=true</code> to enable style selection for
                      this feature.
                    </Text>
                    <Anchor size="xs" c="dimmed" style={{ cursor: 'default' }}>
                      Keep summaries concise to reduce token usage.
                    </Anchor>
                  </Popover.Dropdown>
                </Popover>
              </Flex>
              <Text size="sm" fs="italic">
                {result?.text}
              </Text>
            </>
          )}
        </Paper>
      </Collapse>
    </div>
  );
}
