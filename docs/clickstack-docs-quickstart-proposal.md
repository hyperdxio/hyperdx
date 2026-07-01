# Proposal: a machine-readable "Quickstart" contract for ClickStack SDK docs

**Status:** Draft / internal — not yet shared with the docs team **Owner:** _add
your name_ **Audience:** ClickStack docs maintainers
(`ClickHouse/mintlify-docs-dev`), HyperDX app team, web/marketing **Related
code:**
[`packages/app/scripts/generate-integration-guides.mjs`](../packages/app/scripts/generate-integration-guides.mjs),
[`packages/app/src/components/Integrations/IntegrationsDrawer.tsx`](../packages/app/src/components/Integrations/IntegrationsDrawer.tsx),
[`packages/app/src/components/Integrations/integrationsCatalog.tsx`](../packages/app/src/components/Integrations/integrationsCatalog.tsx)

> This document lives in the HyperDX repo as a place to draft what we want to
> ask the docs team to adopt. **Nothing here has been contributed to
> `mintlify-docs-dev` yet** — it's the proposal to bring to that team.

---

## 0. Context: what this PR ships

This PR adds the **`Integrations` component module** (the "Send data to
ClickStack" drawer) plus the generator that feeds it:

- `components/Integrations/IntegrationsDrawer.tsx` — the presentational drawer,
  currently exercised in **Storybook** (`Components/IntegrationsDrawer`). Wiring
  it into the onboarding "Send telemetry" step lands in a follow-up PR.
- `scripts/generate-integration-guides.mjs` — pulls the inline **Install →
  Connect → Run** snippets from the ClickStack SDK MDX and writes a committed
  `components/Integrations/integrationGuides.generated.json`. Run it with
  `yarn generate:integration-guides` to refresh the guides when the docs change.

The generator works today, but it relies on heuristics because the docs aren't
machine-readable. This proposal is about removing those heuristics at the
source. It is **not** a blocker for this PR — the committed JSON ships as-is.

---

## 1. Why

The in-app **"Send data to ClickStack"** integrations drawer shows an inline,
copy‑paste **Install → Connect → Run** quickstart for each language SDK. Today
that content is generated from the SDK MDX in
`ClickHouse/mintlify-docs-dev/clickstack/ingesting-data/sdks/*.mdx` (see the
generator linked above).

The same structured quickstart data would be reusable elsewhere:

- **HyperDX onboarding** (the drawer added in this PR) — the current consumer.
- **Marketing / product pages** — "Get started in 3 steps" blocks on
  clickhouse.com landing pages, comparison pages, etc.
- **CLI / MCP** — a `hdx` quickstart command or an MCP "how do I instrument X"
  answer could read the same source of truth.

One canonical, structured definition → many surfaces, always in sync with the
docs.

## 2. The problem today

The MDX is written for human reading, not extraction, so a consumer has to guess
structure. Our generator works around this by **classifying code blocks by
content** (does this block look like an install command? a connect snippet? a
run command?). That is inherently brittle:

- Section headings differ per page: `## Getting started`, `## Installing`,
  `## Logging`, … There's no stable "this is the quickstart" marker.
- Steps mix tabbed variants (npm **and** yarn, CJS **and** ESM, winston **and**
  pino, Managed **vs** OSS) that collapse into several consecutive code blocks —
  it's ambiguous which one to show.
- Important snippets sometimes sit under the same heading as the install line,
  so naive "first code block per heading" extraction drops them (this is exactly
  why the Browser JS card first rendered only `npm install …`).
- **Placeholders are inconsistent**, so substitution is fragile. Real examples
  currently in the docs:

  | Concept       | Variants seen in the MDX today                                                                             |
  | ------------- | ---------------------------------------------------------------------------------------------------------- |
  | Endpoint      | `http://localhost:4318`, `http://your-otel-collector:4318`, `https://your-otel-collector:4318`             |
  | Ingestion key | `YOUR_INGESTION_API_KEY`, `<YOUR_INGESTION_API_KEY>`, `<YOUR_INGESTION_KEY>`, `**YOUR_INGESTION_API_KEY**` |
  | Service name  | `<NAME_OF_YOUR_APP_OR_SERVICE>`, `<MY_SERVICE_NAME>`, `<YOUR_APP_NAME>`                                    |

  (The `**…**` form is a markdown-bold artifact that leaks literal asterisks
  into code — a good example of why structured fields beat prose.)

The app compensates for the placeholder mess in
[`integrationsCatalog.tsx`](../packages/app/src/components/Integrations/integrationsCatalog.tsx)
via `applyGuideTokens`, which maintains a list of known endpoint/key spellings
and rewrites them at render time. That list is exactly the "regex zoo" §3a below
would let us delete.

## 3. Proposal

Give every SDK / integration page a **stable, machine-readable quickstart
contract**. Two complementary parts:

### 3a. Standard placeholder tokens (low effort, high value)

Adopt a single set of tokens everywhere a snippet needs a value the user must
fill in. Suggested tokens:

| Token                   | Meaning                       |
| ----------------------- | ----------------------------- |
| `{{OTEL_ENDPOINT}}`     | OTLP/HTTP endpoint            |
| `{{INGESTION_API_KEY}}` | Ingestion / authorization key |
| `{{SERVICE_NAME}}`      | User's service name           |

Any consumer (our app, marketing, CLI) can then do one deterministic
substitution instead of maintaining a regex zoo. The docs site itself can render
these tokens as sensible defaults (e.g. `http://localhost:4318`).

This step alone makes our existing generator far more reliable, even before 3b.

### 3b. A structured `quickstart` definition (preferred end state)

Add a `quickstart` block to each page's frontmatter — the single source of truth
that both the rendered docs page and downstream consumers read. Example:

```yaml
---
slug: /use-cases/observability/clickstack/sdks/python
title: 'Python'
sdk:
  id: python
  category: languages # languages | frameworks | infrastructure | cloud | collectors
  signals: [logs, metrics, traces]
  setup_minutes: 3
quickstart:
  - title: Install the SDK
    lang: shell
    code: |
      pip install hyperdx-opentelemetry
      opentelemetry-bootstrap -a install
  - title: Connect to ClickStack
    lang: shell
    code: |
      export OTEL_EXPORTER_OTLP_ENDPOINT="{{OTEL_ENDPOINT}}"
      export OTEL_EXPORTER_OTLP_HEADERS="authorization={{INGESTION_API_KEY}}"
      export OTEL_SERVICE_NAME="{{SERVICE_NAME}}"
  - title: Run your app
    lang: shell
    code: |
      opentelemetry-instrument python app.py
---
```

Guidelines:

- **2–4 steps**, always shaped as **Install → Connect → Run** (steps may be
  omitted when not applicable, e.g. browser SDKs have no "Run").
- **One canonical snippet per step.** Keep tabbed variants (yarn/pnpm,
  Managed/OSS) in the page body, not in the quickstart block.
- The **Connect** step must contain the endpoint and key tokens.
- Render the same `quickstart` block on the docs page (e.g. via a shared
  `<Quickstart>` component) so docs and downstream consumers never drift.

If editing frontmatter for every page is too heavy initially, an acceptable
interim is a **single, consistently-structured `## Quickstart` section** using
Mintlify `<Steps>` with the standard tokens and exactly one code block per step.

## 4. Before / after for our app

- **Today:** heuristic block classification (`extractSteps` in the generator) +
  a placeholder regex list (`applyGuideTokens` in the catalog) + per-page
  quirks. Works, but fragile and needs babysitting when docs change.
- **With 3a:** delete the placeholder regex list; one token map.
- **With 3b:** delete the classifier entirely; the generator just reads
  `quickstart` from frontmatter. New SDKs show up automatically with zero app
  changes.

## 5. Suggested rollout

1. Agree on the token set (§3a) and search/replace existing SDK pages.
2. Add the `quickstart` frontmatter (§3b) to the high-traffic SDKs first:
   `nodejs`, `python`, `golang`, `java`, `browser`, `nextjs`.
3. Add a shared `<Quickstart>` render component on the docs site so the block is
   the single source of truth.
4. Backfill remaining SDKs and the infra/cloud/collector integration pages.
5. Update
   [`generate-integration-guides.mjs`](../packages/app/scripts/generate-integration-guides.mjs)
   to read `quickstart` directly and drop the heuristics.

## 6. Open questions / TODO

- [ ] Identify the docs-repo owner to pitch this to.
- [ ] Confirm the canonical token names with docs + SDK teams.
- [ ] Decide frontmatter `quickstart` vs. a `<Quickstart>` MDX component as the
      source of truth (frontmatter is easier to consume programmatically).
- [ ] Confirm marketing's interest so the schema covers their needs too (e.g.
      per-step descriptions, links).
- [ ] Align SDK ids/categories with the app catalog in
      [`integrationsCatalog.tsx`](../packages/app/src/components/Integrations/integrationsCatalog.tsx).
