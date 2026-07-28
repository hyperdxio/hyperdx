import { useRouter } from 'next/router';
import ReactMarkdown from 'react-markdown';
import { Center, Loader, Modal, ScrollArea, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';

// The repo-root changelog is copied into public/ at build time (see
// next.config.mjs) so it ships as a static asset in every build mode,
// including the ClickStack static export. Fetched lazily the first time the
// modal opens.
const CHANGELOG_FILE = 'CHANGELOG.md';

/**
 * Reduce the root CHANGELOG.md to the release sections the modal shows: drop
 * the `# HyperDX Changelog` H1 and its maintainer-facing preamble, and strip
 * the release-notes markers that the release workflow uses to identify
 * sections.
 */
export function toChangelogBody(text: string): string {
  const firstSection = text.indexOf('\n## ');
  return (firstSection === -1 ? text : text.slice(firstSection + 1))
    .replace(/<!-- hyperdx-release-notes[^>]*-->\n?/g, '')
    .trim();
}

export const ChangelogModal = ({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) => {
  // basePath is '' normally and '/clickstack' in the ClickStack build, where
  // the static asset is served under that prefix.
  const { basePath } = useRouter();

  const { data: markdown, isError } = useQuery({
    enabled: opened,
    queryKey: ['changelog', basePath],
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch(`${basePath}/${CHANGELOG_FILE}`);
      if (!res.ok) {
        throw new Error(`Failed to load changelog: ${res.status}`);
      }
      return toChangelogBody(await res.text());
    },
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="What's New"
      size="lg"
      centered
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <div className="hdx-markdown" data-testid="changelog-modal">
        {isError ? (
          <Text size="sm" c="dimmed">
            Unable to load the changelog.
          </Text>
        ) : markdown == null ? (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        ) : (
          <ReactMarkdown>{markdown}</ReactMarkdown>
        )}
      </div>
    </Modal>
  );
};
