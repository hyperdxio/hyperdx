import { useState } from 'react';
import {
  Anchor,
  Button,
  Collapse,
  Flex,
  Paper,
  Popover,
  Text,
} from '@mantine/core';
import { IconInfoCircle, IconSparkles } from '@tabler/icons-react';

import { Theme, THEME_LABELS } from './logic';

export default function AISummaryPanel({
  isOpen,
  isGenerating,
  result,
  onToggle,
  onRegenerate,
  onDismiss,
  analyzingLabel = 'Analyzing event data...',
  isRealAI = false,
  error,
}: {
  isOpen: boolean;
  isGenerating: boolean;
  result: { text: string; theme?: Theme } | null;
  onToggle: () => void;
  onRegenerate: () => void;
  onDismiss?: () => void;
  analyzingLabel?: string;
  isRealAI?: boolean;
  error?: string | null;
}) {
  const [infoOpen, setInfoOpen] = useState(false);

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
      </Flex>
      <Collapse expanded={isOpen}>
        <Paper
          p="sm"
          mt={6}
          radius="sm"
          style={{
            borderLeft: `3px solid var(--mantine-color-violet-5)`,
            whiteSpace: 'pre-line',
            lineHeight: 1.55,
          }}
        >
          {isGenerating ? (
            <Text size="sm" c="dimmed" fs="italic">
              {analyzingLabel}
            </Text>
          ) : error ? (
            <Text size="sm" c="red">
              {error}
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
                  {!isRealAI && result?.theme && (
                    <Text span c="dimmed" fw={400} ms={6}>
                      {THEME_LABELS[result.theme]}
                    </Text>
                  )}
                </Text>
                {!isRealAI && onDismiss && (
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
                        Happy April Fools! No AI was used. This summary was
                        generated locally from hand-written phrase templates.
                        Your data never left the browser.
                      </Text>
                      <Anchor
                        size="xs"
                        c="dimmed"
                        onClick={() => {
                          setInfoOpen(false);
                          onDismiss();
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        Don&apos;t show again
                      </Anchor>
                    </Popover.Dropdown>
                  </Popover>
                )}
              </Flex>
              <Text size="sm" fs={isRealAI ? undefined : 'italic'}>
                {result?.text}
              </Text>
            </>
          )}
        </Paper>
      </Collapse>
    </div>
  );
}
