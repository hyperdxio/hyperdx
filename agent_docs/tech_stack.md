# HyperDX Technology Stack

## Frontend (`packages/app`)

- **Framework**: Next.js 14 with TypeScript
- **UI Components**: Mantine UI library (`@mantine/core`, `@mantine/dates`, `@mantine/hooks`)
- **State Management**: Jotai (global client state), TanStack Query (server state), URL params (filters)
- **Charts/Visualization**: Recharts, uPlot
- **Code Editor**: CodeMirror (for SQL/JSON editing)
- **Styling**: Mantine's built-in system, SCSS modules when needed

**UI Component Priority**: Mantine components first → Custom components on Mantine primitives → Custom SCSS modules as last resort

## Backend (`packages/api`)

- **Runtime**: Node.js 22+ with TypeScript
- **Framework**: Express.js
- **Database**: ClickHouse (telemetry data), MongoDB via Mongoose (metadata)
- **Authentication**: Passport.js with local strategy
- **Validation**: Zod schemas
- **Telemetry**: Self-instrumented with `@hyperdx/node-opentelemetry`

## Common Utilities (`packages/common-utils`)

- Shared TypeScript utilities for query parsing and ClickHouse operations
- Zod schemas for data validation
- SQL formatting and query building helpers

