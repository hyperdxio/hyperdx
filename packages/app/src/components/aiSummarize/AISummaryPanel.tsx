import { useState } from 'react';
import Markdown from 'react-markdown';
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

import type { AISummarizeTone } from './helpers';
import { TONE_OPTIONS } from './helpers';
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
  tone,
  onToneChange,
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
  tone?: AISummarizeTone;
  onToneChange?: (tone: AISummarizeTone) => void;
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
        {onToneChange && isOpen && (
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            component="label"
            styles={{
              label: { fontWeight: 400 },
            }}
          >
            {TONE_OPTIONS.find(o => o.value === tone)?.label ?? 'Default'}
            <select
              value={tone ?? 'default'}
              onChange={e =>
                onToneChange(e.currentTarget.value as AISummarizeTone)
              }
              style={{
                position: 'absolute',
                inset: 0,
                opacity: 0,
                cursor: 'pointer',
              }}
            >
              {TONE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Button>
        )}
        {onDismiss && !isOpen && (
          <Anchor
            size="xs"
            c="dimmed"
            onClick={onDismiss}
            style={{ cursor: 'pointer' }}
          >
            Don&apos;t show
          </Anchor>
        )}
      </Flex>
      <Collapse expanded={isOpen}>
        <Paper
          p="sm"
          mt={6}
          radius="sm"
          style={{
            borderLeft: `3px solid var(--mantine-color-violet-5)`,
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
                {!isRealAI && (
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
                      {onDismiss && (
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
                      )}
                    </Popover.Dropdown>
                  </Popover>
                )}
              </Flex>
              {isRealAI ? (
                <div
                  className="ai-summary-content"
                  style={{ fontSize: 'var(--mantine-font-size-sm)' }}
                >
                  <Markdown
                    components={{
                      // Keep output compact — no extra wrapper margins
                      p: ({ children }) => (
                        <p style={{ margin: '0.3em 0' }}>{children}</p>
                      ),
                      strong: ({ children }) => (
                        <strong
                          style={{
                            color: 'var(--mantine-color-violet-4)',
                            fontWeight: 600,
                          }}
                        >
                          {children}
                        </strong>
                      ),
                      code: ({ children }) => (
                        <code
                          style={{
                            background: 'var(--mantine-color-default-hover)',
                            padding: '1px 4px',
                            borderRadius: 3,
                            fontSize: '0.9em',
                          }}
                        >
                          {children}
                        </code>
                      ),
                    }}
                  >
                    {result?.text ?? ''}
                  </Markdown>
                </div>
              ) : (
                <Text size="sm" fs="italic" style={{ whiteSpace: 'pre-line' }}>
                  {result?.text}
                </Text>
              )}
            </>
          )}
        </Paper>
      </Collapse>
    </div>
  );
}
