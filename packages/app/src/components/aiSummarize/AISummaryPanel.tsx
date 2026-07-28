// Easter egg: April Fools 2026 — shared presentational component for AI Summarize.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
}: {
  isOpen: boolean;
  isGenerating: boolean;
  result: { text: string; theme: Theme } | null;
  onToggle: () => void;
  onRegenerate: () => void;
  onDismiss: () => void;
  analyzingLabel?: string;
}) {
  const { t } = useTranslation('common');
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
          {isOpen ? t('aiSummary.hide') : t('aiSummary.summarize')}
        </Button>
        {result && isOpen && (
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={onRegenerate}
          >
            {t('aiSummary.regenerate')}
          </Button>
        )}
      </Flex>
      <Collapse expanded={isOpen}>
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
          {isGenerating ? (
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
                  {t('aiSummary.title')}
                  {result && (
                    <Text span c="dimmed" fw={400} ms={6}>
                      {THEME_LABELS[result.theme]}
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
                      {t('aiSummary.disclaimer')}
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
                      {t('aiSummary.dismiss')}
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
