import React from 'react';

// react-markdown v10 is ESM-only, which Jest (with transformIgnorePatterns:
// ['/node_modules/']) cannot parse. Unit tests don't exercise Markdown-to-HTML
// rendering (that's covered by E2E), so this stub just renders the raw markdown
// string, keeping any component that imports react-markdown loadable in tests.
export default function ReactMarkdown({
  children,
}: {
  children?: React.ReactNode;
}) {
  return <>{children}</>;
}
