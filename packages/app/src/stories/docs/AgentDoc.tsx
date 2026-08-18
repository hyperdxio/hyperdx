import type { ReactNode } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Code } from '@mantine/core';

import { CopySnippet } from '@/components/ClickStackOnboarding/CopySnippet';

import styles from './AgentDoc.module.scss';

/** Map relative agent_docs links to Storybook story URLs. */
const STORY_HREFS: Record<string, string> = {
  'code_style.md': '?path=/story/guidelines-code-style--documentation',
  'themes.md': '?path=/story/guidelines-themes--documentation',
  'page_layout.md': '?path=/story/guidelines-page-layout--documentation',
  'data_viz_colors.md':
    '?path=/story/guidelines-data-visualization-colors--documentation',
};

function storyHrefFor(href: string): string | undefined {
  const [path, hash] = href.split('#');
  const story = STORY_HREFS[path.replace(/^\.\//, '')];
  if (!story) return undefined;
  return hash ? `${story}#${hash}` : story;
}

function DocLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (!href) return <span>{children}</span>;
  if (href.startsWith('#')) {
    return <a href={href}>{children}</a>;
  }

  const storyHref = storyHrefFor(href);
  if (storyHref) {
    return <a href={storyHref}>{children}</a>;
  }

  const isExternal = href.startsWith('http://') || href.startsWith('https://');
  return (
    <a
      href={href}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  );
}

function fencedSnippet(children: ReactNode): string {
  return String(children).replace(/\n$/, '');
}

const markdownComponents: Components = {
  a: ({ href, children }) => <DocLink href={href}>{children}</DocLink>,
  // react-markdown wraps fenced blocks in <pre><code>; CopySnippet is the
  // in-product <Code block> + copy button (Terraform, onboarding, etc.).
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const isBlock = Boolean(className);
    if (isBlock) {
      return (
        <div className={styles.snippet}>
          <CopySnippet snippet={fencedSnippet(children)} />
        </div>
      );
    }
    return <Code>{children}</Code>;
  },
};

export function AgentDoc({ markdown }: { markdown: string }) {
  return (
    <div className={`hdx-markdown ${styles.doc}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
