/** Root of the live ClickStack documentation site. */
const DOCS_SITE = 'https://clickhouse.com/docs';

/**
 * Base URL for the live ClickStack documentation. Every `doc` slug below has
 * been verified to resolve (200) against this base — we intentionally derive
 * the catalog from what actually exists in the docs rather than hard-coding
 * setup guides that would drift out of date.
 */
const DOCS_BASE = `${DOCS_SITE}/use-cases/observability/clickstack`;

/**
 * Where we read the raw setup docs from at render time. We consume the
 * ClickStack docs source directly from the ClickHouse docs repo instead of
 * scraping/pre-generating a structured JSON — see the discussion on
 * https://github.com/hyperdxio/hyperdx/pull/2564.
 *
 * `docSource` paths are relative to this (the repo's `clickstack/` folder).
 * Once the docs site serves per-page markdown (append `.md` to a docs URL,
 * behind Mintlify preview today), this can point at that endpoint instead;
 * `docSourceUrl` is the single place to swap.
 */
const DOC_SOURCE_BASE =
  'https://raw.githubusercontent.com/ClickHouse/mintlify-docs-dev/main/clickstack';

export interface IntegrationItem {
  id: string;
  name: string;
  /** Slug appended to `DOCS_BASE`. */
  doc: string;
  /**
   * Path (relative to `DOC_SOURCE_BASE`, without extension) of the markdown
   * doc rendered inline in the drawer. Items without one deep-link to `doc`.
   */
  docSource?: string;
  /** Path to the brand SVG under `/public/integrations` (usually `<id>.svg`). */
  logo?: string;
  /** Two-letter fallback shown when a logo is missing. */
  monogram?: string;
  /** Color for the monogram fallback. */
  color?: string;
  /** Extra search terms beyond the name. */
  keywords?: string[];
}

export interface IntegrationCategory {
  id: string;
  label: string;
  items: IntegrationItem[];
}

export const INTEGRATION_CATEGORIES: IntegrationCategory[] = [
  {
    id: 'languages',
    label: 'Languages',
    items: [
      {
        id: 'browser',
        name: 'Browser',
        doc: 'sdks/browser',
        docSource: 'ingesting-data/sdks/browser',
        logo: '/integrations/browser.svg',
        keywords: ['javascript', 'js', 'web', 'rum'],
      },
      {
        id: 'nodejs',
        name: 'Node.js',
        doc: 'sdks/nodejs',
        docSource: 'ingesting-data/sdks/nodejs',
        logo: '/integrations/nodejs.svg',
        keywords: ['javascript', 'js', 'typescript'],
      },
      {
        id: 'python',
        name: 'Python',
        doc: 'sdks/python',
        docSource: 'ingesting-data/sdks/python',
        logo: '/integrations/python.svg',
      },
      {
        id: 'go',
        name: 'Go',
        doc: 'sdks/golang',
        docSource: 'ingesting-data/sdks/golang',
        logo: '/integrations/go.svg',
        keywords: ['golang'],
      },
      {
        id: 'java',
        name: 'Java',
        doc: 'sdks/java',
        docSource: 'ingesting-data/sdks/java',
        logo: '/integrations/java.svg',
        keywords: ['jvm'],
      },
      {
        id: 'ruby',
        name: 'Ruby on Rails',
        doc: 'sdks/ruby-on-rails',
        docSource: 'ingesting-data/sdks/ruby',
        logo: '/integrations/ruby.svg',
        keywords: ['rails'],
      },
      {
        id: 'elixir',
        name: 'Elixir',
        doc: 'sdks/elixir',
        docSource: 'ingesting-data/sdks/elixir',
        logo: '/integrations/elixir.svg',
        keywords: ['erlang', 'phoenix'],
      },
      {
        id: 'deno',
        name: 'Deno',
        doc: 'sdks/deno',
        docSource: 'ingesting-data/sdks/deno',
        logo: '/integrations/deno.svg',
      },
    ],
  },
  {
    id: 'frameworks',
    label: 'Frameworks',
    items: [
      {
        id: 'nextjs',
        name: 'Next.js',
        doc: 'sdks/nextjs',
        docSource: 'ingesting-data/sdks/nextjs',
        logo: '/integrations/nextjs.svg',
        keywords: ['react'],
      },
      {
        id: 'nestjs',
        name: 'NestJS',
        doc: 'sdks/nestjs',
        docSource: 'ingesting-data/sdks/nestjs',
        logo: '/integrations/nestjs.svg',
        keywords: ['node'],
      },
      {
        id: 'react-native',
        name: 'React Native',
        doc: 'sdks/react-native',
        docSource: 'ingesting-data/sdks/react-native',
        logo: '/integrations/react-native.svg',
        keywords: ['mobile', 'ios', 'android'],
      },
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    items: [
      {
        id: 'kubernetes',
        name: 'Kubernetes',
        doc: 'integrations/kubernetes',
        docSource: 'integration-examples/kubernetes',
        logo: '/integrations/kubernetes.svg',
        keywords: ['k8s', 'helm'],
      },
      {
        id: 'docker',
        name: 'Docker',
        doc: 'ingesting-data',
        logo: '/integrations/docker.svg',
        keywords: ['container'],
      },
      {
        id: 'nginx',
        name: 'Nginx',
        doc: 'integration-examples/nginx-logs',
        docSource: 'integration-examples/nginx-logs',
        logo: '/integrations/nginx.svg',
        keywords: ['proxy', 'web server'],
      },
      {
        id: 'kafka',
        name: 'Kafka',
        doc: 'integration-examples/kafka-logs',
        docSource: 'integration-examples/kafka-logs',
        logo: '/integrations/kafka.svg',
        keywords: ['streaming', 'queue'],
      },
    ],
  },
  {
    id: 'cloud',
    label: 'Cloud',
    items: [
      {
        id: 'aws',
        name: 'AWS',
        doc: 'integration-examples/cloudwatch',
        docSource: 'integration-examples/cloudwatch',
        logo: '/integrations/aws.svg',
        keywords: ['amazon', 'cloudwatch', 'lambda'],
      },
      {
        id: 'gcp',
        name: 'Google Cloud',
        doc: 'ingesting-data',
        logo: '/integrations/gcp.svg',
        keywords: ['gcp'],
      },
      {
        id: 'azure',
        name: 'Azure',
        doc: 'ingesting-data',
        logo: '/integrations/azure.svg',
        keywords: ['microsoft'],
      },
    ],
  },
  {
    id: 'collectors',
    label: 'Collectors',
    items: [
      {
        id: 'opentelemetry',
        name: 'OpenTelemetry',
        doc: 'ingesting-data/opentelemetry',
        docSource: 'ingesting-data/opentelemetry',
        logo: '/integrations/opentelemetry.svg',
        keywords: ['otel', 'otlp', 'collector'],
      },
      {
        id: 'vector',
        name: 'Vector',
        doc: 'ingesting-data/vector',
        docSource: 'ingesting-data/vector',
        logo: '/integrations/vector.svg',
        keywords: ['logs', 'pipeline'],
      },
    ],
  },
];

export function docUrl(slug: string) {
  return `${DOCS_BASE}/${slug}`;
}

/**
 * Full docs URL from a page's frontmatter `slug` (an absolute site path like
 * `/use-cases/observability/clickstack/...`). Preferred for the "View full
 * docs" link since it always matches where the page actually lives.
 */
export function docUrlFromSlug(slug: string) {
  return `${DOCS_SITE}${slug.startsWith('/') ? '' : '/'}${slug}`;
}

/**
 * URL of the raw markdown doc rendered inline for an item, or `null` when the
 * item only deep-links to its docs page. Swap the return value here to move to
 * the docs site's `.md` endpoint once it's live.
 */
export function docSourceUrl(item: IntegrationItem): string | null {
  return item.docSource ? `${DOC_SOURCE_BASE}/${item.docSource}.mdx` : null;
}

/** Telemetry signal an integration can send into ClickStack. */
export type Signal = 'logs' | 'traces' | 'metrics';

export const SIGNAL_LABELS: Record<Signal, string> = {
  logs: 'Logs',
  traces: 'Traces',
  metrics: 'Metrics',
};

/**
 * Which signals each integration brings, shown as chips in the setup guide.
 * Best-effort defaults — adjust per integration as the guides are finalized.
 */
const INTEGRATION_SIGNALS: Record<string, Signal[]> = {
  browser: ['logs', 'traces'],
  nodejs: ['logs', 'traces', 'metrics'],
  python: ['logs', 'traces', 'metrics'],
  go: ['logs', 'traces', 'metrics'],
  java: ['logs', 'traces', 'metrics'],
  ruby: ['logs', 'traces', 'metrics'],
  elixir: ['logs', 'traces', 'metrics'],
  deno: ['logs', 'traces', 'metrics'],
  nextjs: ['logs', 'traces'],
  nestjs: ['logs', 'traces', 'metrics'],
  'react-native': ['logs', 'traces'],
  kubernetes: ['logs', 'metrics'],
  docker: ['logs', 'metrics'],
  nginx: ['logs', 'metrics'],
  kafka: ['logs', 'metrics'],
  aws: ['logs', 'metrics'],
  gcp: ['logs', 'metrics'],
  azure: ['logs', 'metrics'],
  opentelemetry: ['logs', 'traces', 'metrics'],
  vector: ['logs', 'metrics'],
};

export function signalsFor(id: string): Signal[] {
  return INTEGRATION_SIGNALS[id] ?? [];
}

/** Flat lookup of every catalog item by id (for guide headers etc.). */
export const INTEGRATION_ITEMS_BY_ID: Record<string, IntegrationItem> =
  Object.fromEntries(
    INTEGRATION_CATEGORIES.flatMap(cat => cat.items).map(item => [
      item.id,
      item,
    ]),
  );

/** An item shows an inline setup guide when it points at a markdown source. */
export function hasGuide(id: string) {
  return Boolean(INTEGRATION_ITEMS_BY_ID[id]?.docSource);
}
