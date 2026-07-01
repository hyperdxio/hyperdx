import guidesJson from './integrationGuides.generated.json';

/**
 * Base URL for the live ClickStack documentation. Every `doc` slug below has
 * been verified to resolve (200) against this base — we intentionally derive
 * the catalog from what actually exists in the docs rather than hard-coding
 * setup guides that would drift out of date.
 */
const DOCS_BASE =
  'https://clickhouse.com/docs/use-cases/observability/clickstack';

export interface IntegrationItem {
  id: string;
  name: string;
  /** Slug appended to `DOCS_BASE`. */
  doc: string;
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
        logo: '/integrations/browser.svg',
        keywords: ['javascript', 'js', 'web', 'rum'],
      },
      {
        id: 'nodejs',
        name: 'Node.js',
        doc: 'sdks/nodejs',
        logo: '/integrations/nodejs.svg',
        keywords: ['javascript', 'js', 'typescript'],
      },
      {
        id: 'python',
        name: 'Python',
        doc: 'sdks/python',
        logo: '/integrations/python.svg',
      },
      {
        id: 'go',
        name: 'Go',
        doc: 'sdks/golang',
        logo: '/integrations/go.svg',
        keywords: ['golang'],
      },
      {
        id: 'java',
        name: 'Java',
        doc: 'sdks/java',
        logo: '/integrations/java.svg',
        keywords: ['jvm'],
      },
      {
        id: 'ruby',
        name: 'Ruby on Rails',
        doc: 'sdks/ruby-on-rails',
        logo: '/integrations/ruby.svg',
        keywords: ['rails'],
      },
      {
        id: 'elixir',
        name: 'Elixir',
        doc: 'sdks/elixir',
        logo: '/integrations/elixir.svg',
        keywords: ['erlang', 'phoenix'],
      },
      {
        id: 'deno',
        name: 'Deno',
        doc: 'sdks/deno',
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
        logo: '/integrations/nextjs.svg',
        keywords: ['react'],
      },
      {
        id: 'nestjs',
        name: 'NestJS',
        doc: 'sdks/nestjs',
        logo: '/integrations/nestjs.svg',
        keywords: ['node'],
      },
      {
        id: 'react-native',
        name: 'React Native',
        doc: 'sdks/react-native',
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
        doc: 'ingesting-data/kubernetes',
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
        doc: 'ingesting-data',
        logo: '/integrations/nginx.svg',
        keywords: ['proxy', 'web server'],
      },
      {
        id: 'kafka',
        name: 'Kafka',
        doc: 'ingesting-data',
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
        doc: 'ingesting-data',
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
        logo: '/integrations/opentelemetry.svg',
        keywords: ['otel', 'otlp', 'collector'],
      },
      {
        id: 'vector',
        name: 'Vector',
        doc: 'ingesting-data/vector',
        logo: '/integrations/vector.svg',
        keywords: ['logs', 'pipeline'],
      },
    ],
  },
];

export function docUrl(slug: string) {
  return `${DOCS_BASE}/${slug}`;
}

/** Flat lookup of every catalog item by id (for guide headers etc.). */
export const INTEGRATION_ITEMS_BY_ID: Record<string, IntegrationItem> =
  Object.fromEntries(
    INTEGRATION_CATEGORIES.flatMap(cat => cat.items).map(item => [
      item.id,
      item,
    ]),
  );

interface GuideStep {
  title: string;
  lang: string;
  code: string;
}

interface IntegrationGuide {
  id: string;
  title: string;
  docUrl: string;
  steps: GuideStep[];
}

/**
 * Inline setup guides, generated from the ClickStack docs by
 * `scripts/generate-integration-guides.mjs`. Re-run that script to refresh.
 */
export const INTEGRATION_GUIDES = guidesJson as Record<
  string,
  IntegrationGuide
>;

export function hasGuide(id: string) {
  return id in INTEGRATION_GUIDES;
}

/**
 * Substitute the doc placeholders with the team's real ingestion endpoint and
 * key so the inline snippets are copy-paste ready. Also normalizes a couple of
 * upstream markdown artifacts (e.g. `**KEY**`).
 */
/** Matches any OTLP collector URL placeholder (`http(s)://<host>:4318[/path]`). */
const ENDPOINT_PLACEHOLDER_RE = /https?:\/\/[\w.-]+:4318(?:\/[\w./-]*)?/g;

export function applyGuideTokens(
  code: string,
  endpoint: string,
  apiKey: string,
) {
  let out = code.replace(ENDPOINT_PLACEHOLDER_RE, endpoint);
  for (const key of [
    '***YOUR_INGESTION_API_KEY***',
    '<YOUR_INGESTION_API_KEY>',
    '<YOUR_INGESTION_KEY>',
    'YOUR_INGESTION_API_KEY',
  ]) {
    out = out.split(key).join(apiKey);
  }
  if (process.env.NODE_ENV !== 'production' && /:4318\b/.test(out)) {
    // eslint-disable-next-line no-console
    console.warn(
      '[integrationsCatalog] Unsubstituted collector endpoint placeholder ' +
        'remains in guide snippet; applyGuideTokens may need updating.',
    );
  }
  return out;
}
