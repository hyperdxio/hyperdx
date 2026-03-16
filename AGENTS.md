# HyperDX Development Guide

## What is HyperDX?

HyperDX is an observability platform that helps engineers search, visualize, and
monitor logs, metrics, traces, and session replays. It's built on ClickHouse for
blazing-fast queries and supports OpenTelemetry natively.

**Core value**: Unified observability with ClickHouse performance,
schema-agnostic design, and correlation across all telemetry types in one place.

## Architecture (WHAT)

This is a **monorepo** with three main packages:

- `packages/app` - Next.js frontend (TypeScript, Mantine UI, TanStack Query)
- `packages/api` - Express backend (Node.js 22+, MongoDB for metadata,
  ClickHouse for telemetry)
- `packages/common-utils` - Shared TypeScript utilities for query parsing and
  validation

**Data flow**: Apps → OpenTelemetry Collector → ClickHouse (telemetry data) /
MongoDB (configuration/metadata)

## Development Setup (HOW)

```bash
yarn setup          # Install dependencies
yarn dev            # Start full stack (Docker + local services)
```

The project uses **Yarn 4.5.1** workspaces. Docker Compose manages ClickHouse,
MongoDB, and the OTel Collector.

## Working on the Codebase (HOW)

**Before starting a task**, read relevant documentation from the `agent_docs/`
directory:

- `agent_docs/architecture.md` - Detailed architecture patterns and data models
- `agent_docs/tech_stack.md` - Technology stack details and component patterns
- `agent_docs/development.md` - Development workflows, testing, and common tasks
- `agent_docs/code_style.md` - Code patterns and best practices (read only when
  actively coding)

**Tools handle formatting and linting automatically** via pre-commit hooks.
Focus on implementation; don't manually format code.

## Key Principles

1. **Multi-tenancy**: All data is scoped to `Team` - ensure proper filtering
2. **Type safety**: Use TypeScript strictly; Zod schemas for validation
3. **Existing patterns**: Follow established patterns in the codebase - explore
   similar files before implementing
4. **Component size**: Keep files under 300 lines; break down large components
5. **UI Components**: Use custom Button/ActionIcon variants (`primary`,
   `secondary`, `danger`) - see `agent_docs/code_style.md` for required patterns
6. **Testing**: Tests live in `__tests__/` directories; use Jest for
   unit/integration tests

## Running Tests

Each package has different test commands available:

**packages/app** (unit tests only):

```bash
cd packages/app
yarn ci:unit           # Run unit tests
yarn dev:unit          # Watch mode for unit tests
yarn test:e2e          # Run end-to-end tests
yarn test:e2e:ci       # Run end-to-end tests in CI
```

**packages/api** (integration tests only):

```bash
make dev-int-build                  # Build dependencies (run once before tests)
make dev-int FILE=<TEST_FILE_NAME>  # Spins up Docker services and runs tests.
                                    # Ctrl-C to stop and wait for all services to tear down.
```

**packages/common-utils** (both unit and integration tests):

```bash
cd packages/common-utils
yarn ci:unit           # Run unit tests
yarn dev:unit          # Watch mode for unit tests
yarn ci:int            # Run integration tests
yarn dev:int           # Watch mode for integration tests
```

To run a specific test file or pattern:

```bash
yarn ci:unit <path/to/test.ts>                           # Run specific test file
yarn ci:unit --testNamePattern="test name pattern"       # Run tests matching pattern
```

**Lint & type check across all packages:**

```bash
make ci-lint        # Lint + TypeScript check across all packages
make ci-unit        # Unit tests across all packages
```

**E2E tests (Playwright):**

```bash
./scripts/test-e2e.sh                                       # All E2E
./scripts/test-e2e.sh --quiet <file>                        # Single file
./scripts/test-e2e.sh --quiet <file> --grep "\"<pattern>\""  # Pattern match
```

## Important Context

- **Authentication**: Passport.js with team-based access control
- **State management**: Jotai (client), TanStack Query (server), URL params
  (filters)
- **UI library**: Mantine components are the standard (not custom UI)
- **Database patterns**: MongoDB for metadata with Mongoose, ClickHouse for
  telemetry queries

## GitHub Action Workflow (when invoked via @claude)

When working on issues or PRs through the GitHub Action:

1. **Before writing any code**, post a comment outlining your implementation
   plan — which files you'll change, what approach you'll take, and any
   trade-offs or risks. Use `gh issue comment` for issues or `gh pr comment` for
   PRs.

2. **After making any code changes**, always run these in order and fix any
   failures before opening a PR:

   - `make ci-lint` — lint + TypeScript type check
   - `make ci-unit` — unit tests

3. Write a clear PR description explaining what changed and why.

## Git Commits

When committing code, use the git author's default profile (name and email from
git config). Do not add `Co-Authored-By` trailers.

**Pre-commit hooks must pass before committing.** Do not use `--no-verify` to
skip hooks. If the pre-commit hook fails (e.g. due to husky not being set up in
a worktree), run `npx lint-staged` manually before committing to ensure lint and
formatting checks pass. Fix any issues before creating the commit.

---

_Need more details? Check the `agent_docs/` directory or ask which documentation
to read._
