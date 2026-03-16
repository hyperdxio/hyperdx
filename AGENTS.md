# AGENTS.md - HyperDX Agentic Coding Guide

## Project Overview

HyperDX is an observability platform (logs, metrics, traces, session replays)
built on ClickHouse + OpenTelemetry. Yarn 4.5.1 monorepo with three packages:

- `packages/app` - Next.js frontend (Mantine UI, TanStack Query, Jotai)
- `packages/api` - Express backend (Node.js 22+, MongoDB, ClickHouse)
- `packages/common-utils` - Shared TypeScript utilities (query parsing,
  validation)

Read `agent_docs/` for detailed architecture, tech stack, and code style docs
before making changes.

## Build / Lint / Test Commands

### Setup

```bash
yarn setup          # Install deps + husky hooks
yarn dev            # Start full stack (Docker + local services)
```

### Lint & Type Check (run before every PR)

```bash
make ci-lint        # Lint + TypeScript check across all packages
# Per-package:
cd packages/app && yarn ci:lint
cd packages/api && yarn ci:lint
cd packages/common-utils && yarn ci:lint
```

### Unit Tests

```bash
make ci-unit                                    # All packages
cd packages/app && yarn ci:unit                 # App only
cd packages/common-utils && yarn ci:unit        # Common-utils only
# Single file:
cd packages/app && yarn ci:unit path/to/test.ts
cd packages/common-utils && yarn ci:unit path/to/test.ts
# Pattern match:
cd packages/app && yarn ci:unit --testNamePattern="pattern"
```

### Integration Tests (API + common-utils, requires Docker)

```bash
make dev-int-build                              # Build deps (run once)
make dev-int FILE=<TEST_FILE_NAME>              # API integration test (single file)
make dev-int-common-utils FILE=<TEST_FILE_NAME> # Common-utils integration test
```

### E2E Tests (Playwright)

```bash
./scripts/test-e2e.sh                                       # All E2E
./scripts/test-e2e.sh --quiet <file>                        # Single file
./scripts/test-e2e.sh --quiet <file> --grep "\"<pattern>\""  # Pattern match
```

## Code Style

### Formatting (auto-enforced by pre-commit hooks)

- **Prettier**: 80 char width, 2-space indent, single quotes, trailing commas,
  no parens on single arrow params
- **ESLint**: Flat config per package. `simple-import-sort` enforced
- **Pre-commit**: Husky + lint-staged runs Prettier + ESLint on staged files.
  Never use `--no-verify`
- If hooks fail, run `npx lint-staged` manually before committing

### Import Order (enforced by `simple-import-sort`)

```tsx
// 1. React/Next/third-party libraries
import React from 'react';
import { useRouter } from 'next/router';
import { Button } from '@mantine/core';
// 2. Internal @/ aliases
import { api } from '@/api';
// 3. Parent imports
import { util } from '../utils';
// 4. Sibling/index imports
import { Component } from './Component';
// 5. Style imports
import styles from './styles.module.scss';
```

### TypeScript

- Avoid `any` (eslint warns on `no-explicit-any` in most packages)
- Use Zod schemas for runtime validation
- Prefix unused vars/args with `_` (e.g., `_unused`)
- `strict: true` in tsconfig; target ES2022
- Define interfaces for component props and data structures

### Naming Conventions

- Files: descriptive names following package conventions; no
  "temp"/"v2"/"refactored" suffixes
- React: functional components with hooks only, no class components
- Tests: co-located in `__tests__/` directories

### Error Handling

- Use `console.warn()` and `console.error()` only (`console.log` is banned via
  `no-console` rule)
- Implement error boundaries for React components
- Server-side: always validate and sanitize on the backend
- Multi-tenancy: all data access MUST filter by team context

### React / Frontend Patterns

- State: Jotai (client), TanStack Query (server), URL params (filters)
- Icons: `@tabler/icons-react` only (no `bi-` icons)
- Use `react-hook-form` with `@hookform/resolvers` for forms; `no-use-watch`
  rule enforced
- `react-hooks/exhaustive-deps` is set to error
- Max 300 lines per file; split large components

### Button & ActionIcon Variants (REQUIRED - ESLint-enforced)

Only use these custom variants for `Button` and `ActionIcon`:

```tsx
<Button variant="primary">Save</Button>      // Primary actions
<Button variant="secondary">Cancel</Button>  // Secondary actions
<Button variant="danger">Delete</Button>     // Destructive actions
<ActionIcon variant="primary" />
<ActionIcon variant="secondary" />
<ActionIcon variant="danger" />
```

**Forbidden**: `variant="light"`, `"filled"`, `"outline"`, `"default"` on
Button/ActionIcon. (`variant="filled"` is fine on form inputs like Select,
TextInput.) Icon-only buttons must use `ActionIcon`, not `Button` wrapping an
icon.

### Backend Patterns

- Express routers in `packages/api/src/routers/`, controllers in `controllers/`
- MongoDB models in `packages/api/src/models/` with Mongoose; team-scoped
- ClickHouse queries built via `common-utils` helpers
- Authentication: Passport.js with team-based access control

## Git Conventions

- **Pre-commit hooks must pass**. Do not skip with `--no-verify`. If hooks fail
  (e.g. husky not set up in a worktree), run `npx lint-staged` manually before
  committing to ensure lint and formatting checks pass
- Use the git author's default profile; do not add `Co-Authored-By` trailers
- Branch naming: prefix with your username (e.g., `warren/HDX-3588-feature`)
- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`
- Reference Linear tickets when applicable

## GitHub Action Workflow (when invoked via @claude)

1. **Before writing code**, post a comment outlining your implementation plan
   (which files, approach, trade-offs). Use `gh issue comment` or
   `gh pr comment`
2. **After code changes**, run in order and fix failures before opening a PR:
   - `make ci-lint` — lint + TypeScript type check
   - `make ci-unit` — unit tests
3. Write a clear PR description explaining what changed and why

## CI Checklist (before opening PRs)

1. `make ci-lint` - must pass
2. `make ci-unit` - must pass
3. Write a clear PR description explaining what changed and why

## Cursor Rules

- Playwright E2E tests follow conventions in
  `.claude/skills/playwright/SKILL.md`
- Run E2E via: `./scripts/test-e2e.sh --quiet <file> [--grep "\"<pattern>\""]`

## Key File Locations

| Area                | Path                                     |
| ------------------- | ---------------------------------------- |
| API routes          | `packages/api/src/routers/`              |
| API controllers     | `packages/api/src/controllers/`          |
| MongoDB models      | `packages/api/src/models/`               |
| Frontend pages      | `packages/app/pages/`                    |
| Frontend components | `packages/app/src/`                      |
| Shared utils        | `packages/common-utils/src/`             |
| Mantine theme       | `packages/app/src/theme/mantineTheme.ts` |
| API config          | `packages/api/src/config.ts`             |
| Docker dev          | `docker-compose.dev.yml`                 |
| Agent docs          | `agent_docs/`                            |
