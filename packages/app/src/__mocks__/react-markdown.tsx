// Jest mock for react-markdown (ESM-only module that Jest can't transform).
// Renders children as plain text — sufficient for unit tests.
export default function Markdown({
  children,
}: {
  children?: string;
  components?: Record<string, unknown>;
}) {
  return <div data-testid="markdown">{children}</div>;
}
