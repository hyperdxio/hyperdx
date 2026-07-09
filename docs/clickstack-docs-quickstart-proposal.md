# Proposal: a machine-readable "Quickstart" contract for ClickStack SDK docs

**Status:** Draft / internal — not yet shared with the docs team **Owner:** _add
your name_ **Audience:** ClickStack docs maintainers
(`ClickHouse/mintlify-docs-dev`), HyperDX app team, web/marketing **Related
code:**
[`packages/app/src/components/Integrations/useIntegrationDoc.ts`](../packages/app/src/components/Integrations/useIntegrationDoc.ts),
[`packages/app/src/components/Integrations/IntegrationDocMarkdown.tsx`](../packages/app/src/components/Integrations/IntegrationDocMarkdown.tsx),
[`packages/app/src/components/Integrations/integrationsCatalog.tsx`](../packages/app/src/components/Integrations/integrationsCatalog.tsx)

> This document lives in the HyperDX repo as a place to draft what we want to
> ask the docs team to adopt. **Nothing here has been contributed to
> `mintlify-docs-dev` yet** — it's the proposal to bring to that team.

---

## 0. Context: how the drawer reads docs today

The **"Send data to ClickStack"** integrations drawer renders each SDK's setup
guide **directly from the ClickStack docs source** at render time
(`useIntegrationDoc` fetches the markdown, `IntegrationDocMarkdown` renders it).
We deliberately do **not** pre-generate or restructure the content, and we no
longer substitute the team's endpoint / ingestion key into the snippets — the
drawer shows the docs verbatim and a note tells the user to replace the
placeholder values with the ones in the Connection panel. This follows the
direction in
[hyperdxio/hyperdx#2564](https://github.com/hyperdxio/hyperdx/pull/2564):
render the docs' own markdown in-product rather than scrape a structure out of
prose that has none.

Today we read the raw MDX from
`ClickHouse/mintlify-docs-dev/clickstack/ingesting-data/sdks/*.mdx` and strip
the MDX-isms (frontmatter, `import`/`export`, `<Tabs>`/`<Tab>` wrappers) client
side. That works, but it's why this proposal exists: a small amount of
structure at the source would make the in-product rendering cleaner and unlock
reuse. **None of it blocks the current drawer.**

---

## 1. Why

The same doc content is (or will be) reused across several surfaces:

- **HyperDX onboarding** — the integrations drawer (current consumer).
- **A dedicated integrations page** — a fuller browse/setup surface planned to
  render the same docs.
- **Marketing / product pages** — "Get started in 3 steps" blocks on
  clickhouse.com landing pages, comparison pages, etc.
- **CLI / MCP** — a `hdx` quickstart command or an MCP "how do I instrument X"
  answer could read the same source of truth.

One canonical, structured definition → many surfaces, always in sync with the
docs.

## 2. The problem today

The MDX is written for human reading, not extraction/embedding, so a consumer
has to compensate:

- **No served-markdown endpoint (yet).** Appending `.md` to a docs URL serves
  clean per-page markdown only behind the Mintlify preview flag; publicly it
  still returns the SPA HTML, so we read the raw MDX from GitHub instead and
  strip MDX components ourselves. A stable, public `.md` (or `.mdx`) endpoint
  would let us drop the GitHub-raw dependency and the client-side cleanup.
- **MDX components don't render as plain markdown.** `<Tabs>`/`<Tab>`,
  `<Steps>`, `<CodeGroup>`, etc. have to be flattened. Tabbed variants (npm
  **and** yarn, CJS **and** ESM, Managed **vs** OSS) all collapse into the
  inline view.
- **Placeholders are inconsistent**, which is why we no longer substitute them.
  Real examples currently in the docs:

  | Concept       | Variants seen in the MDX today                                                                             |
  | ------------- | ---------------------------------------------------------------------------------------------------------- |
  | Endpoint      | `http://localhost:4318`, `http://your-otel-collector:4318`, `https://your-otel-collector:4318`             |
  | Ingestion key | `YOUR_INGESTION_API_KEY`, `<YOUR_INGESTION_API_KEY>`, `<YOUR_INGESTION_KEY>`, `**YOUR_INGESTION_API_KEY**` |
  | Service name  | `<NAME_OF_YOUR_APP_OR_SERVICE>`, `<MY_SERVICE_NAME>`, `<YOUR_APP_NAME>`                                    |

  (The `**…**` form is a markdown-bold artifact that leaks literal asterisks
  into code — a good example of why consistent tokens beat prose.)

## 3. Proposal

Two complementary asks for the docs team, in order of effort:

### 3a. A stable per-page markdown endpoint

Serve clean markdown for each page at a predictable URL (e.g. `<page-url>.md`)
in production, not just under the preview flag. That lets in-product consumers
fetch and render the docs' own content without depending on GitHub raw or
re-implementing MDX flattening.

### 3b. Standard placeholder tokens (low effort, high value)

Adopt a single set of tokens everywhere a snippet needs a value the user must
fill in. Suggested tokens:

| Token                   | Meaning                       |
| ----------------------- | ----------------------------- |
| `{{OTEL_ENDPOINT}}`     | OTLP/HTTP endpoint            |
| `{{INGESTION_API_KEY}}` | Ingestion / authorization key |
| `{{SERVICE_NAME}}`      | User's service name           |

Consistent tokens make the drawer's "replace these values" note unambiguous and
would let any consumer highlight or (optionally) substitute them deterministically.

### 3c. Lightweight structured frontmatter (preferred end state)

Add a small structured block to each page's frontmatter so downstream surfaces
(the drawer, the future integrations page, marketing, CLI) can build catalogs
and filters without hard-coding them app-side:

```yaml
---
slug: /use-cases/observability/clickstack/sdks/python
title: 'Python'
sdk:
  id: python
  category: languages # languages | frameworks | infrastructure | cloud | collectors
  signals: [logs, metrics, traces]
  setup_minutes: 3
---
```

Today the app hard-codes `category` and `signals` in `integrationsCatalog.tsx`;
sourcing them from frontmatter keeps the catalog in sync with the docs and lets
new SDKs show up with fewer app changes.

## 4. Suggested rollout

1. Ship a public per-page `.md` endpoint (§3a); switch `docSourceUrl` in
   [`integrationsCatalog.tsx`](../packages/app/src/components/Integrations/integrationsCatalog.tsx)
   to it and drop the client-side MDX cleanup in
   [`useIntegrationDoc.ts`](../packages/app/src/components/Integrations/useIntegrationDoc.ts).
2. Agree on the token set (§3b) and search/replace existing SDK pages.
3. Add the structured frontmatter (§3c) to high-traffic SDKs first
   (`nodejs`, `python`, `golang`, `java`, `browser`, `nextjs`), then backfill.
4. Have the app read `category`/`signals` from frontmatter instead of the
   hard-coded maps in the catalog.

## 5. Open questions / TODO

- [ ] Identify the docs-repo owner to pitch this to.
- [ ] Confirm a public `.md` endpoint is feasible (URL shape, caching, CORS).
- [ ] Confirm the canonical token names with docs + SDK teams.
- [ ] Confirm marketing's interest so the schema covers their needs too (e.g.
      per-step descriptions, links).
- [ ] Align SDK ids/categories with the app catalog in
      [`integrationsCatalog.tsx`](../packages/app/src/components/Integrations/integrationsCatalog.tsx).
