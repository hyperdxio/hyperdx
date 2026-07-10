# syntax=docker/dockerfile:1
#
# HDX-4755 — Eval runner container.
#
# A container image, DISTINCT from the HyperDX image, with every dependency the
# eval harness needs pre-baked so CI startup is fast and no per-run dependency
# install happens:
#   - Node.js + the hdx-eval workspace deps (installed at build time)
#   - the Claude Code CLI (`claude`) the harness spawns as a subprocess
#   - `uv` (only needed if a stdio ClickHouse MCP is configured; harmless otherwise)
#
# The eval package runs straight from TypeScript via `tsx` (its `dev` script),
# so no separate compile step is required in this image — we bake the source
# and node_modules and invoke the CLI through the workspace `dev` script.
#
# Build (from repo root):
#   docker build -f docker/hdx-eval-runner/Dockerfile -t hdx-eval-runner .
#
# Run (wired up by .github/workflows/evals.yml):
#   docker run --rm --network <net> \
#     -e ANTHROPIC_API_KEY -e HDX_EVAL_API_URL -e HDX_EVAL_CH_URL \
#     -v "$PWD/eval-output:/work/packages/hdx-eval/runs" \
#     hdx-eval-runner /work/docker/hdx-eval-runner/run-evals.sh

ARG NODE_VERSION=22.23.1

FROM node:${NODE_VERSION}-bookworm-slim AS runner

# curl + ca-certificates for health probing and the uv installer.
# git is occasionally needed by tooling that resolves workspace metadata.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# Install uv (Astral) for the optional stdio ClickHouse MCP. Pinned copy in
# /usr/local/bin so it is on PATH for every process the harness spawns.
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh

# Install the Claude Code CLI globally so `claude` is on PATH. The harness
# (packages/hdx-eval/src/harness/claudeSpawn.ts) spawns it directly.
RUN npm install -g @anthropic-ai/claude-code \
    && claude --version

WORKDIR /work

# --- Dependency layer -------------------------------------------------------
# Copy only the files needed for `yarn install` so the (slow) install layer is
# cached and only re-runs when the lockfile or a package manifest changes.
COPY .yarn ./.yarn
COPY .yarnrc.yml yarn.lock package.json ./
# tsconfig.base.json is extended by the hdx-eval tsconfig; tsx needs it at
# runtime to resolve the `@/*` path alias used throughout the eval source.
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages/hdx-eval/package.json ./packages/hdx-eval/package.json

# Focus the hdx-eval workspace: installs its deps (and dev deps like tsx) only.
RUN --mount=type=cache,target=/root/.yarn/berry/cache,id=yarn-cache \
    corepack enable \
    && yarn workspaces focus @hyperdx/hdx-eval \
    && yarn cache clean

# --- Source layer -----------------------------------------------------------
# Copy the eval package source and the repo scripts it sources (dev-env.sh).
COPY packages/hdx-eval ./packages/hdx-eval
COPY scripts ./scripts
COPY docker/hdx-eval-runner/run-evals.sh ./docker/hdx-eval-runner/run-evals.sh
RUN chmod +x ./docker/hdx-eval-runner/run-evals.sh

# The harness writes MCP configs with secrets to a temp dir and cleans them up;
# it also writes runs/ under the package. Nothing else needs to be writable.
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=8192

# Default command runs the full M1 pipeline. Override args to run individual
# `yarn workspace @hyperdx/hdx-eval dev <command>` steps for debugging.
ENTRYPOINT ["/bin/bash"]
CMD ["/work/docker/hdx-eval-runner/run-evals.sh"]
