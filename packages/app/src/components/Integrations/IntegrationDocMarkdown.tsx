import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ActionIcon, Box, CopyButton, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';

function extractText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (
    children &&
    typeof children === 'object' &&
    'props' in children &&
    (children as { props?: { children?: ReactNode } }).props
  ) {
    return extractText(
      (children as { props: { children?: ReactNode } }).props.children,
    );
  }
  return '';
}

function CodeBlock({ code }: { code: string }) {
  return (
    <Box
      style={{
        position: 'relative',
        background: 'var(--color-bg-muted)',
        borderRadius: 8,
      }}
    >
      <Box
        component="pre"
        style={{
          margin: 0,
          padding: '12px 44px 12px 14px',
          fontFamily:
            'var(--mantine-font-family-monospace, ui-monospace, monospace)',
          fontSize: 12.5,
          lineHeight: 1.6,
          color: 'var(--color-text)',
          whiteSpace: 'pre',
          overflowX: 'auto',
        }}
      >
        {code}
      </Box>
      <CopyButton value={code}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={copy}
              style={{ position: 'absolute', top: 6, right: 6 }}
            >
              {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Box>
  );
}

/**
 * Renders a ClickStack setup doc (cleaned markdown) with the drawer's visual
 * language: copy-able code blocks, muted inline code, and themed typography.
 * Kept free of any drawer-specific chrome so a future integrations page can
 * render the same content.
 */
export function IntegrationDocMarkdown({ body }: { body: string }) {
  return (
    <Box style={{ color: 'var(--color-text)', fontSize: 14, lineHeight: 1.6 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <Text fw={700} fz={16} mt={18} mb={8}>
              {children}
            </Text>
          ),
          h2: ({ children }) => (
            <Text fw={700} fz={15} mt={18} mb={8}>
              {children}
            </Text>
          ),
          h3: ({ children }) => (
            <Text fw={600} fz={14} mt={14} mb={6}>
              {children}
            </Text>
          ),
          h4: ({ children }) => (
            <Text fw={600} fz={13} mt={12} mb={6}>
              {children}
            </Text>
          ),
          p: ({ children }) => (
            <Text component="p" fz={14} my={8}>
              {children}
            </Text>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              style={{
                color: 'var(--click-global-color-text-link-default, #437eef)',
              }}
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <Box component="ul" style={{ paddingLeft: 20, margin: '8px 0' }}>
              {children}
            </Box>
          ),
          ol: ({ children }) => (
            <Box component="ol" style={{ paddingLeft: 20, margin: '8px 0' }}>
              {children}
            </Box>
          ),
          li: ({ children }) => (
            <Box component="li" style={{ margin: '4px 0' }}>
              {children}
            </Box>
          ),
          table: ({ children }) => (
            <Box style={{ overflowX: 'auto', margin: '10px 0' }}>
              <Box
                component="table"
                style={{
                  borderCollapse: 'collapse',
                  width: '100%',
                  fontSize: 13,
                }}
              >
                {children}
              </Box>
            </Box>
          ),
          th: ({ children }) => (
            <Box
              component="th"
              px={10}
              py={6}
              style={{
                textAlign: 'left',
                borderBottom: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                fontWeight: 600,
              }}
            >
              {children}
            </Box>
          ),
          td: ({ children }) => (
            <Box
              component="td"
              px={10}
              py={6}
              style={{
                borderBottom: '1px solid var(--color-border)',
                verticalAlign: 'top',
              }}
            >
              {children}
            </Box>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }: ComponentPropsWithoutRef<'code'>) => {
            const text = extractText(children).replace(/\n$/, '');
            const isBlock =
              (className?.includes('language-') ?? false) ||
              text.includes('\n');
            if (!isBlock) {
              return (
                <Box
                  component="code"
                  px={5}
                  style={{
                    background: 'var(--color-bg-muted)',
                    borderRadius: 4,
                    fontFamily:
                      'var(--mantine-font-family-monospace, ui-monospace, monospace)',
                    fontSize: '0.9em',
                  }}
                >
                  {children}
                </Box>
              );
            }
            return <CodeBlock code={text} />;
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </Box>
  );
}
