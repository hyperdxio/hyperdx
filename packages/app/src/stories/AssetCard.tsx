import { type ReactNode, useRef, useState } from 'react';
import { Button, Group, Paper, Stack, Text } from '@mantine/core';
import { IconCheck, IconCopy, IconDownload } from '@tabler/icons-react';

import { copySvg, downloadSvg, svgFromContainer } from './downloadSvg';

export function AssetCard({
  title,
  description,
  filename,
  children,
}: {
  title: string;
  description?: string;
  filename: string;
  children: ReactNode;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const getMarkup = () => svgFromContainer(previewRef.current);

  const handleDownload = () => {
    const markup = getMarkup();
    if (markup) downloadSvg(filename, markup);
  };

  const handleCopy = async () => {
    const markup = getMarkup();
    if (!markup) return;
    await copySvg(markup);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Paper
      p="md"
      withBorder
      radius="md"
      style={{ minWidth: 220, flex: '1 1 220px' }}
    >
      <Stack gap="sm">
        <div>
          <Text size="sm" fw={600}>
            {title}
          </Text>
          {description ? (
            <Text size="xs" c="var(--color-text-muted)">
              {description}
            </Text>
          ) : null}
        </div>
        <div
          ref={previewRef}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 88,
            padding: 12,
            borderRadius: 8,
            background: 'var(--color-bg-muted)',
            color: 'var(--color-text)',
          }}
        >
          {children}
        </div>
        <Group gap="xs">
          <Button
            variant="secondary"
            size="xs"
            leftSection={<IconDownload size={14} />}
            onClick={handleDownload}
          >
            Download SVG
          </Button>
          <Button
            variant="subtle"
            size="xs"
            leftSection={
              copied ? <IconCheck size={14} /> : <IconCopy size={14} />
            }
            onClick={handleCopy}
          >
            {copied ? 'Copied' : 'Copy SVG'}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
