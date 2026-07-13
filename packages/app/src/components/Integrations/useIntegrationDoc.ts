import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { docSourceUrl, type IntegrationItem } from './integrationsCatalog';

export interface IntegrationDoc {
  /** Title parsed from the doc frontmatter, if present. */
  title?: string;
  /** Absolute docs-site slug parsed from the frontmatter, if present. */
  slug?: string;
  /** Cleaned markdown body, ready to hand to `react-markdown`. */
  body: string;
}

/** Read a single scalar key out of the frontmatter block. */
function frontmatterValue(block: string, key: string): string | undefined {
  const line = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(block);
  return line ? line[1].replace(/^['"]|['"]$/g, '').trim() : undefined;
}

/** Pull `title`/`slug` off the top of the doc and drop the frontmatter block. */
function stripFrontmatter(raw: string): {
  title?: string;
  slug?: string;
  body: string;
} {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!match) return { body: raw };
  return {
    title: frontmatterValue(match[1], 'title'),
    slug: frontmatterValue(match[1], 'slug'),
    body: match[2],
  };
}

/**
 * The docs are authored in MDX. `react-markdown` renders CommonMark only, so we
 * strip the MDX-isms (import/export statements, component wrappers) while
 * keeping the human-readable content. Tab labels are preserved as bold text so
 * the "Package Import" / "Script Tag" style variants stay distinguishable.
 *
 * Fenced code blocks are passed through untouched — we only transform prose.
 */
function cleanMdx(body: string): string {
  const lines = body.split('\n');
  const out: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    // Drop MDX import/export statements.
    if (/^\s*(import|export)\s.+?(from\s+['"].*['"];?|=)\s*$/.test(line)) {
      continue;
    }

    const next = line
      // Keep tab/step labels as bold text before stripping the wrapper tag.
      .replace(
        /<(?:Tab|TabItem|Step|Accordion)\b[^>]*\b(?:title|label)=["']([^"']+)["'][^>]*>/g,
        '\n**$1**\n',
      )
      // Remove <br> variants outright.
      .replace(/<br\s*\/?>/g, '')
      // Strip remaining MDX component tags (capitalized), keeping inner text.
      .replace(/<\/?[A-Z][A-Za-z0-9]*\b[^>]*>/g, '');

    // A line that became empty only because it held a component tag is dropped
    // to avoid piling up blank lines.
    if (next.trim() === '' && line.trim() !== '') continue;
    out.push(next);
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseIntegrationDoc(raw: string): IntegrationDoc {
  const { title, slug, body } = stripFrontmatter(raw);
  return { title, slug, body: cleanMdx(body) };
}

/**
 * Fetches an integration's setup doc straight from the ClickStack docs source
 * and returns it as cleaned markdown. Reused by the integrations drawer and
 * (later) a full integrations page, so both render the exact same content.
 */
export function useIntegrationDoc(
  item: IntegrationItem | undefined,
): UseQueryResult<IntegrationDoc> {
  const url = item ? docSourceUrl(item) : null;
  return useQuery<IntegrationDoc>({
    queryKey: ['integration-doc', item?.id],
    enabled: Boolean(url),
    // Docs change rarely; avoid refetching within a session.
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(url as string);
      if (!res.ok) {
        throw new Error(`Failed to load setup guide (${res.status})`);
      }
      return parseIntegrationDoc(await res.text());
    },
  });
}
