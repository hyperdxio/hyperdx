import React from 'react';

// @clickhouse/click-ui's barrel export pulls in react-syntax-highlighter for
// CodeBlock, whose prism build depends on ESM-only hastscript that Jest cannot
// parse. Unit tests never render a click-ui CodeBlock, so this stub only needs
// the surface the click-ui module touches at import time.
function Highlighter({ children }: { children?: React.ReactNode }) {
  return <pre>{children}</pre>;
}

Highlighter.registerLanguage = () => undefined;

export const Light = Highlighter;
export const Prism = Highlighter;
export const PrismLight = Highlighter;
export const createElement = () => null;
export default Highlighter;
