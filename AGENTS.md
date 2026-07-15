# HyperDX Development Guide

## What is HyperDX?

HyperDX is an observability platform that helps engineers search, visualize, and
monitor logs, metrics, traces, and session replays. It's built on ClickHouse for
blazing-fast queries and supports OpenTelemetry natively.

**Core value**: Unified observability with ClickHouse performance,
schema-agnostic design, and correlation across all telemetry types in one place.

## Architecture (WHAT)

This is a **monorepo** with six packages:

- `packages/app` - Next.js frontend (TypeScript, Mantine UI, TanStack Query)
- `packages/api` - Express backend (Node.js 22+, MongoDB for metadata,
  ClickHouse for telemetry). Also hosts the **MCP server**, **External API v2**,
  and **OpAMP server** as sub-applications.
- `packages/common-utils` - Shared TypeScript utilities for query parsing and
  validation
- `packages/cli` - Terminal CLI and interactive TUI (`hdx`) for searching,
  tailing, and inspecting logs and traces (Ink/React). Has its own
  [`AGENTS.md`](packages/cli/AGENTS.md) with detailed architecture and
  keybindings.
- `packages/otel-collector` - Custom-built OpenTelemetry Collector (Go, OCB).
  See its [`README.md`](packages/otel-collector/README.md) for architecture,
  included components, and upgrade procedures.
- `packages/hdx-eval` - AI eval framework for benchmarking MCP servers against
  observability scenarios. Generates deterministic synthetic telemetry, spawns
  agents, and grades with programmatic checks + LLM-as-judge. See its
  [`README.md`](packages/hdx-eval/README.md) for setup and usage, and
  [`agent_docs/evals.md`](agent_docs/evals.md) for the dual-slot A/B
  comparison workflow.

**Data flow**: Apps → OpenTelemetry Collector → ClickHouse (telemetry data) /
MongoDB (configuration/metadata)

## Development Setup (HOW)

```bash
yarn setup          # Install dependencies
yarn dev            # Start full stack with worktree-isolated ports
```

The project uses **Yarn 4.13.0** workspaces. Docker Compose manages ClickHouse,
MongoDB, and the OTel Collector.

**This repo is multi-agent friendly.** `yarn dev`, `make dev-int`, and
`make dev-e2e` all use slot-based port isolation so multiple worktrees can run
dev servers, integration tests, and E2E tests simultaneously without conflicts.
A dev portal at http://localhost:9900 auto-starts and shows all running stacks.
See [`agent_docs/development.md`](agent_docs/development.md) for the full
multi-worktree setup, port allocation tables, and available commands.

## Working on the Codebase (HOW)

**Before starting a task**, read relevant documentation from the `agent_docs/`
directory:

- `agent_docs/architecture.md` - Detailed architecture patterns and data models
- `agent_docs/tech_stack.md` - Technology stack details and component patterns
- `agent_docs/development.md` - Development workflows, testing, and common tasks
- `agent_docs/code_style.md` - Code patterns and best practices (read only when
  actively coding)
- `agent_docs/observability.md` - Instrumentation standards (tracing, metrics,
  context) and the shared helpers (read when adding or changing a feature)

**Package-specific guides** (read when working on that package):

- `packages/cli/AGENTS.md` - CLI/TUI architecture, keybindings, web frontend
  alignment, key patterns
- `packages/otel-collector/README.md` - Collector build process, included
  components, upgrade procedures, adding custom components
- `MCP.md` - MCP server setup and available tools (user-facing)

**After finishing all code edits**, run `yarn lint:fix` to auto-fix formatting
and lint issues across all packages. Pre-commit hooks handle this when
committing, but if you finish edits without committing, run `yarn lint:fix`
before stopping.

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
7. **Observability**: This is an observability product - instrument new code as
   you write it. Every team-scoped operation must carry team/user context
   (`setBusinessContext`), and countable log events should also emit a metric.
   For our own instrumentation we favor wide events — enrich the unit-of-work
   span with rich, high-cardinality attributes and keep only span _names_ and
   _metric_ attributes low-cardinality — while metrics stay first-class
   (counters/histograms feed alerts and SLOs, and many deployments rely on
   them). Use the shared helpers in
   `packages/api/src/utils/instrumentation.ts`. See
   [`agent_docs/observability.md`](agent_docs/observability.md).
8. **EE extensibility**: this repo is upstream of an enterprise fork — build
   extension seams, not fork-edited function bodies. See "Designing for
   Downstream (EE) Extensibility" below.

## Running Tests

Each package has different test commands available:

**packages/app** (unit tests only):

```bash
cd packages/app
yarn ci:unit           # Run unit tests
yarn dev:unit          # Watch mode for unit tests
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

**packages/cli** (type check only, no test suite):

```bash
cd packages/cli
npx tsc --noEmit        # Type check
```

**Lint & type check across all packages:**

```bash
make ci-lint        # Lint + TypeScript check across all packages
make ci-unit        # Unit tests across all packages
```

**E2E tests (Playwright):**

```bash
# First-time setup (install Chromium browser):
cd packages/app && yarn playwright install chromium

# Run all E2E tests:
make e2e

# Run a specific test file (dev mode: hot reload):
make dev-e2e FILE=navigation                    # Match files containing "navigation"
make dev-e2e FILE=navigation GREP="help menu"   # Also filter by test name
make dev-e2e GREP="should navigate"             # Filter by test name across all files
make dev-e2e FILE=navigation REPORT=1           # Open HTML report after run
make dev-e2e-clean                               # Remove test artifacts
```

## Designing for Downstream (EE) Extensibility

HyperDX has an enterprise fork (hyperdx-ee) that receives regular upstream
merges from this repo. Every inline edit EE makes to an OSS file becomes a
merge conflict on the next upstream merge — the EE "conflict resolution"
agent exists to clean those up, and we would rather not need it. Design OSS
features so EE can extend them **without editing OSS function bodies,
schemas, or test files**:

1. **Extension seams over inline edits.** When a feature has lifecycle
   points downstream will plausibly hook into (a session starting, a
   delivery going out), expose a typed hook registry with no-op defaults —
   see `packages/api/src/services/agentRunExtensions.ts` for the reference
   pattern. Hook runners must be fail-open (an extension error never breaks
   the core flow) and instrumented (a span per hook invocation plus an
   outcome counter).
2. **Downstream-owned override files.** Registration happens in designated
   files that upstream commits to never editing after creation — see
   `packages/api/src/extensions/index.ts`. EE replaces the file's body
   wholesale, so upstream merges never conflict on it.
3. **Additive, schema-free extension data.** Give downstream a
   `metadata: Mixed` field on models it needs to decorate (see
   `AgentRun.metadata`) instead of having it add typed fields to OSS
   schemas.
4. **Options objects / optional trailing parameters** on exported functions
   downstream feeds data into — adding an optional key never conflicts;
   reshaping a signature does.
5. **Swappable defaults.** Operator-visible defaults downstream may want to
   replace wholesale — prompts, templates, message copy — should resolve
   through a hook (see `onProvisionAgent`'s `systemPrompt` and
   `onSessionStart`'s `promptOverride` in `agentRunExtensions.ts`), not sit as
   hardcoded constants at the call site.
6. **OSS tests never require EE edits.** Test the hook contract in OSS with
   a fake extension; EE tests its own extensions in its own files.

When building a feature EE is likely to extend, add the seam in the same PR.
Retrofitting a seam after EE has already forked the file is exactly the
conflict this section exists to prevent.

### Seam exports and `knip`

A seam contract (the interfaces/types EE implements against — e.g. the
`Agent*Result` types in `agentRunExtensions.ts`) is exported public API that
has **no importer inside this repo by design**: OSS ships no extensions, so
only the downstream fork consumes it. Our `knip` check (run in the pre-commit
hook and CI) would otherwise flag those exports as unused.

The rule: mark a genuinely-downstream-only export with a JSDoc `@public` tag and
a one-line reason. `knip.json` sets `"tags": ["-public"]`, so `@public`-tagged
exports are treated as intentional public API rather than dead code. This is
scoped per-export — an export that is used nowhere at all (not even in-file, not
tagged) is still reported, so the check keeps its teeth. Do **not** reach for a
blanket `ignoreExportsUsedInFile` category toggle to silence a seam export; tag
the specific export instead. Conversely, an export that only turned out to be
unused (no EE consumer planned) should be **unexported or removed**, not tagged.

## Important Context

- **Authentication**: Passport.js with team-based access control
- **State management**: Jotai (client), TanStack Query (server), URL params
  (filters)
- **UI library**: Mantine components are the standard (not custom UI)
- **Database patterns**: MongoDB for metadata with Mongoose, ClickHouse for
  telemetry queries

## PR Hygiene for Agent-Generated Code

When using agentic tools to generate PRs, follow these practices to keep reviews
efficient and accurate:

1. **Scope PRs to a single logical change**, even if the agent can produce more
   in one session. Smaller, focused PRs move through the review pipeline faster
   and are easier to classify accurately.

2. **Write the PR description to explain intent (the "why"), not just what
   changed.** Reviewers need to understand the goal to catch cases where the
   agent solved the wrong problem or made a plausible-but-wrong trade-off.

3. **Name agent-generated branches with a `claude/`, `agent/`, or `ai/` prefix**
   (e.g., `claude/add-rate-limiting`). This allows the PR triage classifier to
   apply appropriate scrutiny and lets reviewers calibrate their attention.

4. **Write or update tests alongside the implementation**, not after. Configure
   your agent to produce tests before writing implementation code. See the
   Testing section below for the commands to use.

5. **Ensure a changeset exists before pushing a PR.** Any change to a published
   package (`@hyperdx/app`, `@hyperdx/api`, `@hyperdx/otel-collector`, etc.) that
   is user-facing or affects behavior must include a changeset in `.changeset/`.
   Add one with `yarn changeset` (or create the markdown file by hand following
   the format of existing entries), choosing the appropriate semver bump, before
   pushing the branch. Skip only for changes that don't warrant a release (docs,
   internal tooling, tests, CI).

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

## Merge Conflict Resolution

1. **Never blindly pick a side.** Read both sides of every conflict to
   understand the intent of each change before choosing a resolution.

2. **Refactor/move conflicts require extra verification.** When one side
   refactored, moved, or extracted code (e.g., inline components to separate
   files), always diff the discarded side against the destination files before
   declaring the conflict resolved. Code can diverge after extraction — the
   other branch may have made fixes or additions that the extracting branch
   never picked up. A naive "keep ours" resolution silently drops those changes.

3. **Verify the result compiles.** After resolving, check for missing imports,
   broken references, or type errors introduced by the resolution — especially
   when discarding a side that added new dependencies or exports.

4. **Ask for help when uncertain.** If you are not 100% confident about which
   side to keep, or whether a change can be safely discarded, stop and ask for
   manual intervention rather than guessing. A wrong guess silently breaks
   things; asking is always cheaper than debugging later.

## Cursor Cloud specific instructions

### Docker requirement

Docker must be installed and running before starting the dev stack or running
integration/E2E tests. The VM update script handles `yarn install` and
`yarn build:common-utils`, but Docker daemon startup is a prerequisite that must
already be available.

### Starting the dev stack

`yarn dev` uses `sh -c` to source `scripts/dev-env.sh`, which contains
bash-specific syntax (`BASH_SOURCE`). On systems where `/bin/sh` is `dash`
(e.g. Ubuntu), this fails with "Bad substitution". Work around it by running
with bash directly:

```bash
bash -c 'export PATH="/workspace/node_modules/.bin:$PATH" && source ./scripts/dev-env.sh && yarn build:common-utils && dotenvx run --convention=nextjs -- docker compose -p "$HDX_DEV_PROJECT" -f docker-compose.dev.yml up -d && yarn app:dev'
```

Port isolation assigns a slot based on the worktree directory name. In the
default `/workspace` directory, the slot is **76**, so services are at:

- **App**: http://localhost:30276
- **API**: http://localhost:30176
- **ClickHouse**: http://localhost:30576
- **MongoDB**: localhost:30476

### Key commands reference

See `AGENTS.md` above and `agent_docs/development.md` for the full command
reference. Quick summary:

- `make ci-lint` — lint + TypeScript type check
- `make ci-unit` — unit tests (all packages)
- `make dev-int FILE=<name>` — integration tests (spins up Docker services)
- `make dev-e2e FILE=<name>` — E2E tests (Playwright)

### First-time registration

When the dev stack starts fresh (empty MongoDB), the app shows a registration
page. Create any account to get started — no external auth provider is needed.

---

_Need more details? Check the `agent_docs/` directory or ask which documentation
to read._
