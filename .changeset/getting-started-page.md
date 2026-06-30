---
'@hyperdx/app': minor
---

Replace the blocking onboarding modals with a dedicated `/getting-started` page. The page walks users through connecting ClickHouse, creating data sources (with OTel auto-detection), sending telemetry (live ingestion API key + endpoint, integration grid, and an AI coding-agent setup prompt), and exploring their data. Feature pages now redirect unfinished setups to this page instead of opening a non-dismissible modal, and the sidebar "Get Started" checklist links to it.

The "Send telemetry" step's integration grid now opens a searchable, categorized integrations drawer. SDK/framework tiles open inline copy-paste setup guides (with the team's real endpoint and ingestion key substituted in); other integrations deep-link to the docs. The inline guides are generated from the ClickStack docs via `yarn generate:integration-guides`, so they stay in sync with the source docs.
