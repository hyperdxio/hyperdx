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
 *
 * Returns '' when the file has no release sections yet. The preamble is
 * addressed to maintainers ("keep the marker intact when editing"), so falling
 * back to the whole file would show them instructions instead of release notes.
 */
export function toChangelogBody(text: string): string {
  const firstSection = text.indexOf('\n## ');
  if (firstSection === -1) return '';
  return text
    .slice(firstSection + 1)
    .replace(/<!-- hyperdx-release-notes[^>]*-->\n?/g, '')
    .trim();
}

const ALLOWED_LINK_HOSTS = new Set(['github.com', 'docs.hyperdx.io']);

/**
 * Allowlist link targets in the changelog.
 *
 * The changelog body is AI-generated from changeset bodies, commit messages and
 * PR titles — all of which anyone opening a PR can influence — so an off-site
 * link is a phishing surface in every deployment's "What's new" modal. The
 * release workflow greps for disallowed links before publishing, but grep
 * cannot be complete over CommonMark (a bare autolink `<https://host/x>`
 * carries no `](`), so the enforceable check belongs here, where react-markdown
 * hands us the parsed target whatever syntax produced it.
 *
 * Returning '' is react-markdown's own convention for a rejected URL — it is
 * what the library's `defaultUrlTransform` returns for unsafe protocols.
 */
export function allowChangelogUrl(url: string): string {
  try {
    // The base makes a relative target resolve to a host that is never allowed,
    // rather than throwing.
    const parsed = new URL(url, 'https://disallowed.invalid');
    if (parsed.protocol !== 'https:') return '';
    return ALLOWED_LINK_HOSTS.has(parsed.hostname) ? url : '';
  } catch {
    return '';
  }
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
        ) : markdown === '' ? (
          <Text size="sm" c="dimmed">
            No releases yet.
          </Text>
        ) : markdown == null ? (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        ) : (
          // Images are dropped outright and link targets allowlisted at the
          // AST level, so no markdown syntax — inline, reference-style or
          // autolink — can smuggle an off-site image or link into the modal.
          <ReactMarkdown
            disallowedElements={['img']}
            urlTransform={allowChangelogUrl}
          >
            {markdown}
          </ReactMarkdown>
        )}
      </div>
    </Modal>
  );
};
