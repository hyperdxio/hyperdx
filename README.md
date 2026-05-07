# Berg

A Kibana-style web UI for AWS S3 Tables, backed by Athena and the Glue Data
Catalog. Forked from [HyperDX](https://hyperdx.io) / ClickStack and repurposed
for analytical query workflows on Iceberg-managed S3 Tables.

**Core value:** familiar log/discover UX (search, time histograms, row inspect,
saved searches, dashboards) on top of Athena-managed S3 Tables instead of
ClickHouse.

## Architecture

Monorepo with three packages:

| Package | Stack | Role |
|---|---|---|
| `packages/api` | Express, Node 22+, Mongoose | Backend. Auth, sessions, source/dashboard CRUD, Athena query executor, Glue catalog passthrough. |
| `packages/app` | Next.js 16, Mantine, TanStack Query, Jotai | Frontend. Search/Discover, dashboards, SQL editor, source manager. |
| `packages/common-utils` | TypeScript | Shared chart config, Trino SQL emission, Athena type mapping, Zod schemas. |

**Data flow at runtime:** browser → app (Next.js, server-rendered + client) →
api (Express) → Athena (Trino) reading from S3 Tables via the Glue catalog.
MongoDB stores app metadata only (users, teams, sources, dashboards) — never
your data.

## Prerequisites

- Node.js **22.16+** (see `engines` in `package.json`)
- Yarn **4.13** (managed via Corepack — `corepack enable` if not on)
- Docker (for the local Mongo + dev portal — not required if you run Mongo
  externally)
- AWS account with:
  - Athena workgroup + S3 results bucket
  - Glue catalog (regular Glue or S3 Tables federation `s3tablescatalog/...`)
  - IAM principal with `athena:*`, `glue:Get*`, `s3:Get*` / `s3:Put*` on the
    results bucket. For local dev, an `AWS_PROFILE` works; in production use
    EKS IRSA / ECS task role.

## Local Setup

```bash
# 1. Clone + install
git clone <your-fork>.git
cd berg
corepack enable
yarn install

# 2. Seed env files from templates (live names are gitignored)
cp packages/api/.env.development.example  packages/api/.env.development
cp packages/app/.env.development.example  packages/app/.env.development
cp packages/api/.env.test.example         packages/api/.env.test
cp packages/api/.env.e2e.example          packages/api/.env.e2e

# 3. Edit packages/api/.env.development and fill in:
#      ATHENA_REGION
#      ATHENA_OUTPUT_LOCATION
#      GLUE_CATALOG_ID                  (e.g. <account>:s3tablescatalog/<name>)
#      GLUE_DATABASES                   (comma-separated)
#      EXPRESS_SESSION_SECRET           (openssl rand -base64 48)
#      MONGO_URI                        (default: mongodb://localhost:27017/berg)
#      AWS_PROFILE  or  AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
#
#    packages/app/.env.development is good as-is for default ports.

# 4. Start the full dev stack
yarn dev
```

`yarn dev` starts the API (port 8000), App (port 8080), and a worktree-isolated
Docker MongoDB. A dev portal at <http://localhost:9900> shows all running
stacks.

First boot: visit <http://localhost:8080>, register any account (no external
auth provider required), then add a Source from the Catalog page to start
querying.

### Multi-worktree dev

The repo is multi-agent friendly — `yarn dev`, `make dev-int`, and `make
dev-e2e` use slot-based port isolation derived from the worktree directory
name, so multiple checkouts can run simultaneously without port collisions.
See [`agent_docs/development.md`](agent_docs/development.md).

## Tests

```bash
make ci-lint            # lint + TypeScript check across all packages
make ci-unit            # unit tests across all packages

# Per-package:
cd packages/app           && yarn ci:unit
cd packages/common-utils  && yarn ci:unit
make dev-int FILE=<name>                # api integration tests (Docker)
make dev-e2e FILE=<name>                # Playwright E2E
```

## Production Deploy

The repo ships with multi-stage Dockerfiles for both packages.

### Build images

```bash
DOCKER_BUILDKIT=1 docker build \
  --build-arg PORT=8000 \
  --build-arg CODE_VERSION=$(git rev-parse --short HEAD) \
  -f packages/api/Dockerfile -t berg-api:$(git rev-parse --short HEAD) .

DOCKER_BUILDKIT=1 docker build \
  --build-arg PORT=8080 \
  -f packages/app/Dockerfile -t berg-app:$(git rev-parse --short HEAD) .
```

### Required runtime config (no `.env` files inside the image)

| Service | Var | Notes |
|---|---|---|
| api | `MONGO_URI` | Atlas / DocumentDB / self-hosted Mongo |
| api | `EXPRESS_SESSION_SECRET` | Long random string (`openssl rand -base64 48`) |
| api | `FRONTEND_URL` | Public URL of the app — used for cookie domain + post-login redirect |
| api | `ATHENA_REGION` / `ATHENA_WORKGROUP` / `ATHENA_OUTPUT_LOCATION` | |
| api | `GLUE_CATALOG_ID` | `<account>:s3tablescatalog/<catalog>` for S3 Tables; unset for default Glue |
| api | `GLUE_DATABASES` | Comma-separated list of databases visible in the catalog browser |
| api | AWS credentials | EKS IRSA / ECS task role / `AWS_*` env vars (avoid baking long-lived keys) |
| app | `SERVER_URL` | Internal URL of the api (e.g. `http://berg-api.<ns>:8000`) |
| app | `NEXT_PUBLIC_BERG_BASE_PATH` | Optional URL prefix when serving under a sub-path |

### Deploy targets

The image is portable; how you orchestrate is your choice.

- **EKS** — image + Deployment / Service / Ingress / ServiceAccount with IRSA
  annotation. API needs the IRSA role with Athena/Glue/S3 permissions.
- **ECS Fargate** — image + task definition (env vars or Secrets Manager) +
  service. Task role has the AWS perms.
- **Single EC2 / docker compose** — fastest to stand up; weakest HA.

You also need:

- **MongoDB** for app metadata (users / teams / sources / dashboards). Atlas,
  DocumentDB, or self-hosted — `MONGO_URI` points at it.
- **TLS termination** in front of the app (ALB, CloudFront, or your reverse
  proxy of choice). Cookies are flagged secure when `FRONTEND_URL` uses
  `https://`.
- **Outbound network** from the api to Athena (`athena.<region>.amazonaws.com`),
  Glue (`glue.<region>.amazonaws.com`), and S3 for query results.

### Smoke-test locally with the prod images

```bash
docker run --rm -p 8000:8000 \
  --env-file packages/api/.env.development \
  berg-api:<sha>

docker run --rm -p 8080:8080 \
  -e SERVER_URL=http://host.docker.internal:8000 \
  berg-app:<sha>
```

## Pre-commit secret scanner

A pre-commit hook (`scripts/check-secrets.sh`, wired into `.husky/pre-commit`)
blocks commits that introduce AWS account IDs adjacent to AWS resource
references, AKIA-prefixed access keys, or `AWS_SECRET_ACCESS_KEY=...`
assignments. Bypass per-line with `# allow-secret-scan` for legitimate
placeholders or doc examples.

## Repo Layout

```
packages/
  api/              # Express backend (Node 22+, Mongo + Athena)
  app/              # Next.js 16 frontend (Mantine, TanStack Query)
  common-utils/     # Shared TS: chart config, Trino SQL, Athena type mapping
agent_docs/         # Architecture, dev workflows, code style
docs/superpowers/
  specs/            # Validated design specs (committed)
  plans/            # Per-session execution plans (gitignored)
scripts/            # dev-env, port allocation, secret scanner
```

Each package also has its own `AGENTS.md` with scope-specific gotchas (Trino
dialect rules in `common-utils`, multi-tenancy invariants in `api`, row-WHERE
patterns in `app`).

## Contributing

See [`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md) for code style,
testing, commit, and merge-conflict-resolution guidelines. PR descriptions
should explain *why* not just *what*; agent-generated branches should use a
`claude/`, `agent/`, or `ai/` prefix so reviewers can calibrate scrutiny.

## License

[MIT](LICENSE)
