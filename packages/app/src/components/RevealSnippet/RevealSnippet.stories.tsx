import { Box, Card, Group, Paper, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { RevealSnippet } from './RevealSnippet';

const SAMPLE_API_KEY = 'hdx_ing_9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c';
const SAMPLE_ACCESS_KEY = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const SAMPLE_ORG_ID = 'org_abc123def456';
const SAMPLE_ENDPOINT = 'https://abc123.otel.clickhouse.cloud:4318';

const COLLECTOR_YAML = [
  'exporters:',
  '  otlphttp:',
  `    endpoint: ${SAMPLE_ENDPOINT}`,
  '    headers:',
  `      authorization: ${SAMPLE_API_KEY}`,
].join('\n');

const AI_PROMPT = [
  'Instrument this app with OpenTelemetry and export to:',
  `  endpoint: ${SAMPLE_ENDPOINT}`,
  `  authorization: ${SAMPLE_API_KEY}`,
  `  org: ${SAMPLE_ORG_ID}`,
].join('\n');

const MCP_JSON = [
  '{',
  '  "mcpServers": {',
  '    "hyperdx": {',
  '      "command": "npx",',
  '      "args": ["-y", "@hyperdx/mcp-server"],',
  '      "env": {',
  `        "HYPERDX_API_KEY": "${SAMPLE_ACCESS_KEY}"`,
  '      }',
  '    }',
  '  }',
  '}',
].join('\n');

const CLAUDE_CLI_ONELINER = `claude mcp add hyperdx -- npx -y @hyperdx/mcp-server --api-key ${SAMPLE_ACCESS_KEY}`;

/**
 * `RevealSnippet` is a generic, reveal-aware code snippet. You give it the
 * snippet with real secrets already inlined plus a set of `[real, redacted]`
 * pairs; it masks those values for display until the user reveals them, while
 * copy always hands back the real text.
 *
 * It's a **compound component**. The parts share reveal state via context, so
 * the surrounding layout (header row, panel chrome, button placement) is
 * entirely up to the caller:
 *
 * - `RevealSnippet.Code` — the snippet body as a code block (redacted at rest).
 * - `RevealSnippet.Reveal` — the show/hide toggle. Renders nothing when there's
 *   nothing to reveal or `canReveal={false}`.
 * - `RevealSnippet.Copy` — copies the real value regardless of reveal state
 *   (`variant="icon"` or `"button"`).
 * - `RevealSnippet.Input` — a self-contained read-only field for a single
 *   secret (its own inline eye + copy); use it instead of Code/Reveal/Copy.
 *
 * **Masking rules** (the `secrets` prop):
 * - Omitted or empty → nothing is masked; renders as a plain copyable snippet
 *   (the safe default).
 * - `secrets={[value]}` (bare string) → the whole value is masked via
 *   `defaultRedact` (prefix + dots). Good for a bare credential like an API key.
 * - `secrets={[[real, redacted], …]}` → only those substrings are masked. Good
 *   for a config/prompt where the secret is embedded in surrounding text.
 * - Entries can be mixed, and `null` entries are skipped — so
 *   `secrets={[maybeKey]}` is safe.
 *
 * This is the shared primitive behind the Team Settings API-key fields and the
 * MCP install snippets (CLI command, deep-link JSON fallback, plain JSON).
 *
 * Use the **Brand** (HyperDX / ClickStack) and **Theme** (Light / Dark) toolbar
 * toggles to review every combination.
 */
const meta: Meta<typeof RevealSnippet> = {
  title: 'Components/RevealSnippet',
  globals: { brand: 'clickstack' },
  component: RevealSnippet,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <Box style={{ maxWidth: 620 }}>
        <Story />
      </Box>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof RevealSnippet>;

/**
 * The whole `value` is the secret. Pass it as a bare string in `secrets` and
 * the component masks it via `defaultRedact` — the first few chars stay visible
 * and the rest becomes dots, padded to the original length so the field width
 * doesn't jump on reveal. This is how the Team Settings API-key fields render.
 */
export const ApiKeyField: Story = {
  name: 'API key field (Input, whole-value mask)',
  render: () => (
    <Card withBorder p="md">
      <Text size="sm" fw={600} mb="xs">
        Ingestion API key
      </Text>
      <RevealSnippet value={SAMPLE_API_KEY} secrets={[SAMPLE_API_KEY]}>
        <RevealSnippet.Input
          aria-label="Ingestion API key"
          revealLabel="Reveal key"
          copyLabel="Copy key"
        />
      </RevealSnippet>
    </Card>
  ),
};

/**
 * A single masked secret embedded in a larger config. Only the API key is
 * replaced with its stand-in; the rest of the YAML stays readable. Reveal and
 * an icon copy sit in the header row; `Code` scrolls horizontally (`wrap=false`)
 * so YAML indentation is preserved.
 */
export const SingleSecretInConfig: Story = {
  name: 'Single secret in a config',
  render: () => (
    <Paper withBorder radius="md" p="sm">
      <RevealSnippet
        value={COLLECTOR_YAML}
        secrets={[[SAMPLE_API_KEY, 'hdx_api_xxx']]}
      >
        <Group justify="space-between" align="center" mb="xs">
          <Text size="sm" fw={600}>
            Collector config
          </Text>
          <Group gap="xs">
            <RevealSnippet.Reveal />
            <RevealSnippet.Copy label="Copy collector config" />
          </Group>
        </Group>
        <RevealSnippet.Code wrap={false} />
      </RevealSnippet>
    </Paper>
  ),
};

/**
 * Multiple `[real, redacted]` pairs — the API key and the org id are masked
 * independently and both restored on reveal. Copy always yields the real text.
 * The reveal label is customized (`Reveal secrets` / `Hide secrets`) and the
 * copy renders as a labelled button.
 */
export const MultipleSecrets: Story = {
  render: () => (
    <Paper withBorder radius="md" p="sm">
      <RevealSnippet
        value={AI_PROMPT}
        secrets={[
          [SAMPLE_API_KEY, 'hdx_api_xxx'],
          [SAMPLE_ORG_ID, 'org_xxx'],
        ]}
      >
        <Group justify="space-between" align="center" mb="xs">
          <Text size="sm" fw={600}>
            AI instrumentation prompt
          </Text>
          <RevealSnippet.Reveal
            showLabel="Reveal secrets"
            hideLabel="Hide secrets"
          />
        </Group>
        <RevealSnippet.Code />
        <Group justify="flex-end" mt="xs">
          <RevealSnippet.Copy label="Copy prompt" variant="button" />
        </Group>
      </RevealSnippet>
    </Paper>
  ),
};

/**
 * The MCP install shapes the onboarding panel renders, both masking the
 * personal access key: a one-line CLI command and a JSON config block. Each is
 * an independent `RevealSnippet`, so reveal state is scoped per snippet.
 */
export const McpInstallSnippets: Story = {
  name: 'MCP install snippets',
  render: () => (
    <Stack gap="md">
      <Paper withBorder radius="md" p="sm">
        <RevealSnippet
          value={CLAUDE_CLI_ONELINER}
          secrets={[SAMPLE_ACCESS_KEY]}
        >
          <Group justify="space-between" align="center" mb="xs">
            <Text size="sm" fw={500}>
              Paste in your terminal:
            </Text>
            <Group gap="xs">
              <RevealSnippet.Reveal />
              <RevealSnippet.Copy variant="button" />
            </Group>
          </Group>
          <RevealSnippet.Code />
        </RevealSnippet>
      </Paper>

      <Paper withBorder radius="md" p="sm">
        <RevealSnippet value={MCP_JSON} secrets={[SAMPLE_ACCESS_KEY]}>
          <Group justify="space-between" align="center" mb="xs">
            <Text size="sm" fw={500}>
              Or paste this JSON into Cursor settings &gt; MCP:
            </Text>
            <Group gap="xs">
              <RevealSnippet.Reveal />
              <RevealSnippet.Copy variant="button" />
            </Group>
          </Group>
          <RevealSnippet.Code wrap={false} />
        </RevealSnippet>
      </Paper>
    </Stack>
  ),
};

/**
 * `RevealSnippet.Input` is fully self-contained — it renders its own inline
 * reveal eye and copy icon, so it needs no sibling `Reveal` / `Copy`. Stack
 * several to show a credentials block (each row scoped to its own value).
 */
export const InputCredentialsBlock: Story = {
  name: 'Input — credentials block',
  render: () => (
    <Card withBorder p="md">
      <Stack gap="md">
        <Box>
          <Text size="sm" fw={600} mb={4}>
            Ingestion API key
          </Text>
          <RevealSnippet value={SAMPLE_API_KEY} secrets={[SAMPLE_API_KEY]}>
            <RevealSnippet.Input aria-label="Ingestion API key" />
          </RevealSnippet>
        </Box>
        <Box>
          <Text size="sm" fw={600} mb={4}>
            Personal access key
          </Text>
          <RevealSnippet
            value={SAMPLE_ACCESS_KEY}
            secrets={[SAMPLE_ACCESS_KEY]}
          >
            <RevealSnippet.Input aria-label="Personal access key" />
          </RevealSnippet>
        </Box>
      </Stack>
    </Card>
  ),
};

/**
 * The `Reveal` render-prop override: keep the reveal state + "nothing to
 * reveal" gating from the component, but render a completely custom control.
 * Here the whole header row acts as the toggle.
 */
export const CustomRevealControl: Story = {
  name: 'Custom reveal control (render prop)',
  render: () => (
    <Paper withBorder radius="md" p="sm">
      <RevealSnippet
        value={COLLECTOR_YAML}
        secrets={[[SAMPLE_API_KEY, 'hdx_api_xxx']]}
      >
        <RevealSnippet.Reveal>
          {({ revealed, toggle, label }) => (
            <Group
              justify="space-between"
              align="center"
              mb="xs"
              onClick={toggle}
              style={{ cursor: 'pointer' }}
              role="button"
              aria-label={label}
            >
              <Text size="sm" fw={600}>
                Collector config
              </Text>
              <Text size="xs" c="dimmed">
                {revealed ? 'Click to hide' : 'Click to reveal'}
              </Text>
            </Group>
          )}
        </RevealSnippet.Reveal>
        <RevealSnippet.Code wrap={false} />
      </RevealSnippet>
    </Paper>
  ),
};

/**
 * Reveal disabled (e.g. a non-admin viewer): the snippet stays redacted and the
 * `Reveal` toggle renders nothing, but copy is still available — copy hands back
 * the real value even when reveal is gated off.
 */
export const RevealDisabled: Story = {
  name: 'Reveal disabled (non-admin)',
  render: () => (
    <Paper withBorder radius="md" p="sm">
      <RevealSnippet
        value={COLLECTOR_YAML}
        secrets={[[SAMPLE_API_KEY, 'hdx_api_xxx']]}
        canReveal={false}
      >
        <Group justify="space-between" align="center" mb="xs">
          <Text size="sm" fw={600}>
            Collector config
          </Text>
          <Group gap="xs">
            <RevealSnippet.Reveal />
            <RevealSnippet.Copy label="Copy collector config" />
          </Group>
        </Group>
        <RevealSnippet.Code wrap={false} />
      </RevealSnippet>
    </Paper>
  ),
};

/**
 * A nullable secret (`secrets={[null]}`) — e.g. a ClickHouse Cloud deployment
 * that has no key to embed. Nothing is masked, the reveal toggle is absent, and
 * the snippet behaves like a plain copyable block. Guards against a crash when
 * a caller passes `secrets={[maybeSecret]}` and the value is `null`.
 */
export const NullableSecret: Story = {
  name: 'Nullable secret (nothing to reveal)',
  render: () => (
    <Paper withBorder radius="md" p="sm">
      <RevealSnippet value={MCP_JSON} secrets={[null]}>
        <Group justify="space-between" align="center" mb="xs">
          <Text size="sm" fw={500}>
            Paste this into your host's MCP config:
          </Text>
          <Group gap="xs">
            <RevealSnippet.Reveal />
            <RevealSnippet.Copy />
          </Group>
        </Group>
        <RevealSnippet.Code wrap={false} />
      </RevealSnippet>
    </Paper>
  ),
};

/**
 * No secrets at all — behaves like a plain copyable snippet; the reveal toggle
 * is absent because there is nothing to unmask. This is the default: with
 * `secrets` omitted, the value is shown as-is. `wrap` lets a long
 * single line break instead of scrolling.
 */
export const NoSecrets: Story = {
  render: () => (
    <RevealSnippet value="npm install @hyperdx/node-opentelemetry">
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="sm" fw={500}>
            Install the SDK
          </Text>
          <RevealSnippet.Copy label="Copy command" />
        </Group>
        <RevealSnippet.Code wrap />
      </Stack>
    </RevealSnippet>
  ),
};
