import { type IconType } from 'react-icons';
import { FaAws, FaJava, FaJsSquare } from 'react-icons/fa';
import {
  SiApachekafka,
  SiDeno,
  SiDocker,
  SiElixir,
  SiGo,
  SiGooglecloud,
  SiKubernetes,
  SiNestjs,
  SiNextdotjs,
  SiNginx,
  SiNodedotjs,
  SiOpentelemetry,
  SiPython,
  SiReact,
  SiRuby,
} from 'react-icons/si';

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
  Icon?: IconType;
  /**
   * Path to a brand SVG under `/public/integrations`. Takes precedence over
   * `Icon` and `monogram` — use it for logos react-icons doesn't carry.
   */
  logo?: string;
  /** Glyph color; defaults to the brand color or theme text when omitted. */
  color?: string;
  /** Two-letter fallback shown when there's no brand icon. */
  monogram?: string;
  /** Extra search terms beyond the name. */
  keywords?: string[];
}

export interface IntegrationCategory {
  id: string;
  label: string;
  items: IntegrationItem[];
}

const TEXT = 'var(--color-text)';

export const INTEGRATION_CATEGORIES: IntegrationCategory[] = [
  {
    id: 'languages',
    label: 'Languages',
    items: [
      {
        id: 'browser',
        name: 'Browser',
        doc: 'sdks/browser',
        Icon: FaJsSquare,
        color: '#f7df1e',
        keywords: ['javascript', 'js', 'web', 'rum'],
      },
      {
        id: 'nodejs',
        name: 'Node.js',
        doc: 'sdks/nodejs',
        Icon: SiNodedotjs,
        color: '#5fa04e',
        keywords: ['javascript', 'js', 'typescript'],
      },
      {
        id: 'python',
        name: 'Python',
        doc: 'sdks/python',
        Icon: SiPython,
        color: '#3776ab',
      },
      {
        id: 'go',
        name: 'Go',
        doc: 'sdks/golang',
        Icon: SiGo,
        color: '#00add8',
        keywords: ['golang'],
      },
      {
        id: 'java',
        name: 'Java',
        doc: 'sdks/java',
        Icon: FaJava,
        color: '#e76f00',
        keywords: ['jvm'],
      },
      {
        id: 'ruby',
        name: 'Ruby on Rails',
        doc: 'sdks/ruby-on-rails',
        Icon: SiRuby,
        color: '#cc342d',
        keywords: ['rails'],
      },
      {
        id: 'elixir',
        name: 'Elixir',
        doc: 'sdks/elixir',
        Icon: SiElixir,
        color: '#4b275f',
        keywords: ['erlang', 'phoenix'],
      },
      {
        id: 'deno',
        name: 'Deno',
        doc: 'sdks/deno',
        Icon: SiDeno,
        color: TEXT,
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
        Icon: SiNextdotjs,
        color: TEXT,
        keywords: ['react'],
      },
      {
        id: 'nestjs',
        name: 'NestJS',
        doc: 'sdks/nestjs',
        Icon: SiNestjs,
        color: '#e0234e',
        keywords: ['node'],
      },
      {
        id: 'react-native',
        name: 'React Native',
        doc: 'sdks/react-native',
        Icon: SiReact,
        color: '#61dafb',
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
        Icon: SiKubernetes,
        color: '#326ce5',
        keywords: ['k8s', 'helm'],
      },
      {
        id: 'docker',
        name: 'Docker',
        doc: 'ingesting-data',
        Icon: SiDocker,
        color: '#2496ed',
        keywords: ['container'],
      },
      {
        id: 'nginx',
        name: 'Nginx',
        doc: 'ingesting-data',
        Icon: SiNginx,
        color: '#009639',
        keywords: ['proxy', 'web server'],
      },
      {
        id: 'kafka',
        name: 'Kafka',
        doc: 'ingesting-data',
        Icon: SiApachekafka,
        color: TEXT,
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
        Icon: FaAws,
        color: '#ff9900',
        keywords: ['amazon', 'cloudwatch', 'lambda'],
      },
      {
        id: 'gcp',
        name: 'Google Cloud',
        doc: 'ingesting-data',
        Icon: SiGooglecloud,
        color: '#4285f4',
        keywords: ['gcp'],
      },
      {
        id: 'azure',
        name: 'Azure',
        doc: 'ingesting-data',
        monogram: 'Az',
        color: '#0078d4',
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
        Icon: SiOpentelemetry,
        color: TEXT,
        keywords: ['otel', 'otlp', 'collector'],
      },
      {
        id: 'vector',
        name: 'Vector',
        doc: 'ingesting-data/vector',
        logo: '/integrations/vector.svg',
        color: '#10b1e7',
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
