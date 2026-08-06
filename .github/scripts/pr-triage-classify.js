'use strict';

// ── File classification patterns ─────────────────────────────────────────────
// Critical paths come in three bands, ordered by how much the size of the diff
// should be allowed to soften them.
//
//   security — Tier 4 at any size, no escape hatch
//   core     — Tier 4 unless the PR merely grazes it (see the graze bounds)
//   infra    — Tier 4 only once substantially modified (INFRA_CRITICAL_MIN_LINES)
//
// Without the bands, a three-line Dockerfile tweak carried the same "domain
// expert sign-off" weight as an auth change.

// Never softened. A one-line change here can invert an authorisation check or
// weaken an input guard, and the cost of missing that dwarfs the review time.
const SECURITY_CRITICAL_PATTERNS = [
  /^packages\/api\/src\/middleware\/auth/,
  // Shared input-validation surface. Every PR that has touched this file was a
  // security fix (webhook URL validation, SSRF guard, password complexity), so
  // it is a high-precision signal despite being an ordinary-looking util.
  /^packages\/api\/src\/utils\/validators\./,
];

// Tenancy, public API surface and shipped configuration. Consequential, but a
// tiny edit inside an otherwise tiny PR reviews like any other small change.
const CORE_CRITICAL_PATTERNS = [
  /^packages\/api\/src\/routers\/api\/me\./,
  /^packages\/api\/src\/routers\/api\/team\./,
  /^packages\/api\/src\/routers\/external-api\//,
  /^packages\/api\/src\/models\/(user|team|teamInvite)\./,
  /^packages\/api\/src\/config\./,
  // local/*.xml are copied into the released all-in-one image (see
  // docker/hyperdx/Dockerfile) and users.xml governs ClickHouse auth, so these
  // are production config rather than local scaffolding.
  /^docker\/clickhouse\//,
];

const INFRA_CRITICAL_PATTERNS = [
  /^packages\/api\/src\/tasks\//,
  /^packages\/otel-collector\//,
  /^docker\/otel-collector\//,
  /^docker\/hyperdx\//,
  /^\.github\/workflows\/(main|release)\.yml$/,
];

// Docs and images carry no functional risk, so they never escalate a PR — not
// even under a critical path (e.g. packages/otel-collector/CHANGELOG.md).
const DOC_PATTERN = /\.(md|txt|png|jpg|jpeg|gif|svg|ico)$/i;

const TIER1_PATTERNS = [
  DOC_PATTERN,
  /^yarn\.lock$/,
  /^package-lock\.json$/,
  /^\.yarnrc\.yml$/,
  /^\.github\/images\//,
  /^\.env\.example$/,
  /^\.changeset\//,  // version-bump config files; no functional code
  /^\.github\/scripts\//,   // GitHub Actions scripts; not application code
  /^\.github\/workflows\//,  // workflow files (main/release.yml also matched by INFRA_CRITICAL_PATTERNS)
];

const TEST_FILE_PATTERNS = [
  /\/__tests__\//,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /^packages\/app\/tests\//,
  // E2E-only ClickHouse fixture, mounted solely by packages/app/tests/e2e. Its
  // siblings (config.xml, users.xml) ship in the image and stay critical.
  /^docker\/clickhouse\/local\/init-db-e2e\.sh$/,
];

// Private packages that are never published. Excluded from production line
// counts, but deliberately not treated as trivial: they still get a review.
const INTERNAL_TOOLING_PATTERNS = [
  /^packages\/hdx-eval\//,
];

// The complete set of files a changesets release PR is allowed to touch.
const RELEASE_ARTIFACT_PATTERNS = [
  /^\.changeset\//,
  /(^|\/)CHANGELOG\.md$/,
  /(^|\/)package\.json$/,
  /^yarn\.lock$/,
  /^\.env$/,
];

// ── Thresholds ────────────────────────────────────────────────────────────────
// Line counts are churn (additions + deletions) and exclude test, trivial and
// internal-tooling files.
// Max prod lines eligible for Tier 2. Briefly raised to 400, then reverted:
// across 600 merged PRs the 250–400 band drew a substantive inline review
// comment 23% of the time versus 8% for 0–50, so a 5–15 minute skim is not
// enough for it. Nothing in that band was ever blocking, so this is a judgement
// call rather than a safety guarantee — revisit with fresh data.
const TIER2_MAX_LINES = 250;
const TIER4_ESCALATION_LINES = 1000;   // Tier 3 → 4 for very large diffs

// Infra-critical paths reach Tier 4 only once the change is substantial.
// Measured as total churn across every infra-critical file, not per file, so a
// change spread thinly across several of them still escalates.
const INFRA_CRITICAL_MIN_LINES = 30;

// A PR only "grazes" a core-critical path when the touch AND the PR as a whole
// are tiny. Both bounds matter: across 600 merged PRs, a <=10-line core-critical
// touch inside a larger PR still drew substantive review comments 50% of the
// time, but when the whole PR was <=50 lines the rate fell to 14% — level with
// the 16% baseline for PRs touching no critical path at all.
const CORE_CRITICAL_GRAZE_LINES = 10;   // max churn on core-critical files
const GRAZE_MAX_PROD_LINES = 50;        // max total production churn for the PR

// Spanning packages only signals architectural risk above a floor — a two-file,
// twenty-line fix that happens to cross a package boundary does not.
const CROSS_LAYER_MIN_LINES = 100;

// ── Other constants ──────────────────────────────────────────────────────────
// Branch names do not affect the tier. Agent-authored PRs are judged on the same
// evidence as anyone else's — what the diff touches and how big it is. Keying off
// a `claude/` prefix only penalised the tools that advertise themselves, while
// equally agent-written `cursor/` branches sailed past.
// Authors whose PRs are trivial by construction — a dependency bump is a
// lockfile and a manifest, whatever its line count.
const BOT_AUTHORS = ['dependabot', 'dependabot[bot]'];

// The account the changesets action runs as. Deliberately NOT in BOT_AUTHORS:
// `github-actions` also authors every PR opened by .github/workflows/claude.yml,
// which runs with secrets.GITHUB_TOKEN. A blanket bot escape here would drop
// agent-authored PRs of any size straight to Tier 1. Only the narrow
// release-artifact path below short-circuits for this account.
const RELEASE_BOT_AUTHORS = ['github-actions', 'github-actions[bot]'];
const RELEASE_BRANCH_PREFIX = 'changeset-release/';

// Lockfiles are enormous and unreadable; they never count toward "how much is
// there to review".
const LOCKFILE_PATTERN = /^(yarn\.lock|package-lock\.json)$/;

const TIER_LABELS = {
  1: { name: 'review/tier-1', color: '0E8A16', description: 'Trivial — auto-merge candidate once CI passes' },
  2: { name: 'review/tier-2', color: '1D76DB', description: 'Low risk — AI review + quick human skim' },
  3: { name: 'review/tier-3', color: 'E4E669', description: 'Standard — full human review required' },
  4: { name: 'review/tier-4', color: 'B60205', description: 'Critical — deep review + domain expert sign-off' },
};

const TIER_INFO = {
  1: {
    emoji: '🟢',
    headline: 'Tier 1 — Trivial',
    detail: 'Docs, images, lock files, a dependency bump, or an automated release. No functional code changes detected.',
    process: 'Auto-merge once CI passes. No human review required.',
    sla: 'Resolves automatically.',
  },
  2: {
    emoji: '🔵',
    headline: 'Tier 2 — Low Risk',
    detail: 'Small, isolated change with no API route or data model modifications.',
    process: 'AI review + quick human skim (target: 5–15 min). Reviewer validates AI assessment and checks for domain-specific concerns.',
    sla: 'Resolve within 4 business hours.',
  },
  3: {
    emoji: '🟡',
    headline: 'Tier 3 — Standard',
    detail: 'Introduces new logic, modifies core functionality, or touches areas with non-trivial risk.',
    process: 'Full human review — logic, architecture, edge cases.',
    sla: 'First-pass feedback within 1 business day.',
  },
  4: {
    emoji: '🔴',
    headline: 'Tier 4 — Critical',
    detail: 'Touches authentication, tenancy data models, the public API or shipped database config — or substantially changes background tasks, the OTel pipeline, image build, or release CI.',
    process: 'Deep review from a domain expert. Synchronous walkthrough may be required.',
    sla: 'Schedule synchronous review within 2 business days.',
  },
};

// ── File classification helpers ──────────────────────────────────────────────
const isTestFile     = f => TEST_FILE_PATTERNS.some(p => p.test(f));
const isTrivialFile  = f => TIER1_PATTERNS.some(p => p.test(f));
const isDocFile      = f => DOC_PATTERN.test(f);

const isSecurityCriticalFile = f => SECURITY_CRITICAL_PATTERNS.some(p => p.test(f));
const isCoreCriticalFile     = f => CORE_CRITICAL_PATTERNS.some(p => p.test(f));
const isInfraCriticalFile    = f => INFRA_CRITICAL_PATTERNS.some(p => p.test(f));
// Path-level check only — whether a core- or infra-critical file actually
// escalates the PR depends on diff size, resolved in computeSignals.
const isCriticalFile = f =>
  isSecurityCriticalFile(f) || isCoreCriticalFile(f) || isInfraCriticalFile(f);

const isInternalToolingFile = f => INTERNAL_TOOLING_PATTERNS.some(p => p.test(f));
const isReleaseArtifactFile = f => RELEASE_ARTIFACT_PATTERNS.some(p => p.test(f));

// ── Signal computation ───────────────────────────────────────────────────────
// Returns a flat object of all facts needed for tier determination and comment
// generation. All derived from PR metadata + file list — no GitHub API calls.
//
// @param {object} pr       - GitHub PR object: { user: { login }, head: { ref } }
// @param {Array}  filesRes - GitHub files array: [{ filename, additions, deletions }]
function computeSignals(pr, filesRes) {
  const author     = pr.user.login;
  const branchName = pr.head.ref;

  const churn = files => files.reduce((sum, f) => sum + f.additions + f.deletions, 0);

  const testFiles = filesRes.filter(f => isTestFile(f.filename));
  const prodFiles = filesRes.filter(f =>
    !isTestFile(f.filename) &&
    !isTrivialFile(f.filename) &&
    !isInternalToolingFile(f.filename)
  );

  const prodLines = churn(prodFiles);
  const testLines = churn(testFiles);

  // Neither tests nor docs can escalate a PR to Tier 4 on their own.
  const criticalCandidates = filesRes.filter(f =>
    !isTestFile(f.filename) && !isDocFile(f.filename)
  );
  // Each file lands in exactly one band, most severe first.
  const securityCriticalFiles = criticalCandidates.filter(f => isSecurityCriticalFile(f.filename));
  const coreCriticalFiles = criticalCandidates.filter(f =>
    isCoreCriticalFile(f.filename) && !isSecurityCriticalFile(f.filename)
  );
  const infraCriticalFiles = criticalCandidates.filter(f =>
    isInfraCriticalFile(f.filename) &&
    !isSecurityCriticalFile(f.filename) &&
    !isCoreCriticalFile(f.filename)
  );

  const coreCriticalLines  = churn(coreCriticalFiles);
  const infraCriticalLines = churn(infraCriticalFiles);

  // Everything a reviewer actually has to read. Unlike prodLines this keeps
  // workflows, Actions scripts and internal-tooling packages in: they are
  // excluded from tiering but are still real code, and a five-line config.ts
  // edit shipped alongside 5000 lines of hdx-eval is not a PR that merely
  // grazes anything.
  const reviewableLines = churn(
    criticalCandidates.filter(f => !LOCKFILE_PATTERN.test(f.filename))
  );

  // A small edit to a core-critical path inside an otherwise small PR reviews
  // like any other small change, so let it fall through to normal sizing. Both
  // size bounds are checked so neither a large excluded bucket nor a large
  // production diff can sneak through.
  const grazesCoreCritical =
    coreCriticalFiles.length > 0 &&
    coreCriticalLines <= CORE_CRITICAL_GRAZE_LINES &&
    prodLines <= GRAZE_MAX_PROD_LINES &&
    reviewableLines <= GRAZE_MAX_PROD_LINES;

  const infraCriticalEscalates = infraCriticalLines >= INFRA_CRITICAL_MIN_LINES;

  const criticalFiles = [
    ...securityCriticalFiles,
    ...(grazesCoreCritical ? [] : coreCriticalFiles),
    ...(infraCriticalEscalates ? infraCriticalFiles : []),
  ];

  const isBotAuthor     = BOT_AUTHORS.includes(author);
  const allFilesTrivial = filesRes.length > 0 && filesRes.every(f => isTrivialFile(f.filename));

  // Automated changesets release PR: version bumps and changelogs only. Guarded
  // on the entire file set, so real code pushed onto a release branch still
  // classifies on its merits.
  const isReleaseArtifactPR =
    (isBotAuthor || RELEASE_BOT_AUTHORS.includes(author)) &&
    branchName.startsWith(RELEASE_BRANCH_PREFIX) &&
    filesRes.length > 0 &&
    filesRes.every(f => isReleaseArtifactFile(f.filename));

  const internalToolingFiles = filesRes.filter(f =>
    isInternalToolingFile(f.filename) && !isTestFile(f.filename) && !isTrivialFile(f.filename)
  );

  // Blocks Tier 2 — API models and routes carry implicit cross-cutting risk
  const touchesApiModels = prodFiles.some(f =>
    f.filename.startsWith('packages/api/src/models/') ||
    f.filename.startsWith('packages/api/src/routers/')
  );

  // Cross-layer: production changes spanning multiple monorepo packages
  const touchesFrontend    = prodFiles.some(f => f.filename.startsWith('packages/app/'));
  const touchesBackend     = prodFiles.some(f => f.filename.startsWith('packages/api/'));
  const touchesSharedUtils = prodFiles.some(f => f.filename.startsWith('packages/common-utils/'));
  const spansLayers = [touchesFrontend, touchesBackend, touchesSharedUtils].filter(Boolean).length >= 2;
  const isCrossLayer = spansLayers && prodLines >= CROSS_LAYER_MIN_LINES;

  return {
    author, branchName,
    prodFiles, prodLines, testLines,
    criticalFiles, securityCriticalFiles, coreCriticalFiles, infraCriticalFiles,
    coreCriticalLines, infraCriticalLines, reviewableLines,
    grazesCoreCritical, infraCriticalEscalates,
    internalToolingFiles,
    isBotAuthor, allFilesTrivial, isReleaseArtifactPR,
    touchesApiModels, touchesFrontend, touchesBackend, touchesSharedUtils,
    spansLayers, isCrossLayer,
  };
}

// ── Tier determination ───────────────────────────────────────────────────────
// @param {object} signals - output of computeSignals()
// @returns {number} tier  - 1 | 2 | 3 | 4
function determineTier(signals) {
  const {
    criticalFiles, isBotAuthor, allFilesTrivial, isReleaseArtifactPR,
    prodLines, touchesApiModels, isCrossLayer,
  } = signals;

  // Tier 1: automated changesets release. Checked ahead of the critical gate —
  // otherwise a two-line otel-collector version bump reads as a critical change.
  if (isReleaseArtifactPR) return 1;

  // Tier 4: security/tenancy surface, or a substantial pipeline change
  if (criticalFiles.length > 0) return 4;

  // Tier 1: bot-authored or only docs/images/lock files changed
  if (isBotAuthor || allFilesTrivial) return 1;

  // Tier 2: small, isolated, single-layer change
  const qualifiesForTier2 =
    prodLines < TIER2_MAX_LINES &&
    !touchesApiModels &&
    !isCrossLayer;
  if (qualifiesForTier2) return 2;

  // Tier 3: everything else — escalate very large diffs to Tier 4
  return prodLines > TIER4_ESCALATION_LINES ? 4 : 3;
}

// ── Comment generation ───────────────────────────────────────────────────────
// @param {number} tier    - 1 | 2 | 3 | 4
// @param {object} signals - output of computeSignals()
// @returns {string}       - Markdown comment body
function buildTierComment(tier, signals) {
  const {
    author, branchName,
    prodFiles, prodLines, testLines, criticalFiles,
    isBotAuthor, allFilesTrivial,
    touchesApiModels, touchesFrontend, touchesBackend, touchesSharedUtils,
    isCrossLayer,
    // Defaulted so older callers (and hand-built fixtures) keep working.
    securityCriticalFiles = [], coreCriticalFiles = [], infraCriticalFiles = [],
    coreCriticalLines = 0, infraCriticalLines = 0,
    grazesCoreCritical = false, infraCriticalEscalates = false,
    internalToolingFiles = [], isReleaseArtifactPR = false, spansLayers = false,
  } = signals;

  const info = TIER_INFO[tier];
  const fileList = files => files.map(f => `    - \`${f.filename}\``).join('\n');
  const criticalChurn = criticalFiles.reduce((sum, f) => sum + f.additions + f.deletions, 0);

  // Assembles the final body from whatever `triggers` and `contextSignals` hold
  // at call time, so an early return can skip the context block.
  const render = () => [
    '<!-- pr-triage -->',
    `## ${info.emoji} ${info.headline}`,
    '',
    info.detail,
    `\n**Why this tier:**\n${triggers.map(t => `- ${t}`).join('\n')}`,
    contextSignals.length > 0 ? `\n**Additional context:** ${contextSignals.join(', ')}` : '',
    '',
    `**Review process**: ${info.process}`,
    `**SLA**: ${info.sla}`,
    '',
    '<details><summary>Stats</summary>',
    '',
    `- Production files changed: ${prodFiles.length}`,
    `- Production lines changed: ${prodLines}${testLines > 0 ? ` (+ ${testLines} in test files, excluded from tier calculation)` : ''}`,
    // Workflow files are both trivial and infra-critical, so a PR can escalate
    // on churn that never reaches prodLines. Show it rather than report 0.
    ...(criticalChurn > 0 && criticalChurn !== prodLines
      ? [`- Critical-path lines changed: ${criticalChurn}`] : []),
    `- Branch: \`${branchName}\``,
    `- Author: ${author}`,
    '',
    '</details>',
    '',
    `> To override this classification, remove the \`${TIER_LABELS[tier].name}\` label and apply a different \`review/tier-*\` label. Manual overrides are preserved on subsequent pushes.`,
  ].join('\n');

  // Primary triggers — the specific reasons this tier was assigned
  const triggers = [];
  if (isReleaseArtifactPR) {
    triggers.push(`**Automated release** (\`${branchName}\`) — version bumps and changelogs only`);
  }
  if (securityCriticalFiles.length > 0) {
    triggers.push(`**Security-critical files** (${securityCriticalFiles.length}) — auth or input validation, escalated at any size:\n${fileList(securityCriticalFiles)}`);
  }
  if (coreCriticalFiles.length > 0 && !grazesCoreCritical) {
    triggers.push(`**Critical-path files** (${coreCriticalFiles.length}) — tenancy, public API, or shipped database config:\n${fileList(coreCriticalFiles)}`);
  }
  if (infraCriticalEscalates && infraCriticalFiles.length > 0) {
    triggers.push(`**Background tasks or delivery pipeline substantially modified** — ${infraCriticalLines} lines (bar: ${INFRA_CRITICAL_MIN_LINES}):\n${fileList(infraCriticalFiles)}`);
  }
  if (tier === 4 && prodLines > TIER4_ESCALATION_LINES && criticalFiles.length === 0) {
    triggers.push(`**Large diff**: ${prodLines} production lines changed (threshold: ${TIER4_ESCALATION_LINES})`);
  }
  if (tier === 3 && prodLines >= TIER2_MAX_LINES) {
    triggers.push(`**Diff size**: ${prodLines} production lines changed (Tier 2 max: < ${TIER2_MAX_LINES})`);
  }
  if (isBotAuthor && !isReleaseArtifactPR) triggers.push(`**Bot author**: \`${author}\``);
  // Guarded on criticalFiles: a workflow file is both trivial and infra-critical,
  // so without this a main.yml rewrite claimed to be "docs / images / lock files"
  // in the same breath as escalating on 35 lines of pipeline churn.
  if (allFilesTrivial && !isBotAuthor && criticalFiles.length === 0) {
    triggers.push('**All files are docs / images / lock files**');
  }
  if (isCrossLayer) {
    const layers = [
      touchesFrontend    && 'frontend (`packages/app`)',
      touchesBackend     && 'backend (`packages/api`)',
      touchesSharedUtils && 'shared utils (`packages/common-utils`)',
    ].filter(Boolean);
    triggers.push(`**Cross-layer change**: touches ${layers.join(' + ')}`);
  }
  if (touchesApiModels && criticalFiles.length === 0) {
    triggers.push('**Touches API routes or data models** — hidden complexity risk');
  }
  if (triggers.length === 0) {
    triggers.push('**Standard feature/fix** — introduces new logic or modifies core functionality');
  }

  // Informational context — didn't drive the tier on their own. Skipped entirely
  // for automated releases, where none of it is actionable.
  const contextSignals = [];
  if (isReleaseArtifactPR) return render();
  if (grazesCoreCritical && coreCriticalFiles.length > 0) {
    contextSignals.push(`grazes a critical path (${coreCriticalLines} lines in \`${coreCriticalFiles[0].filename}\`) inside a ${prodLines}-line PR, so it is tiered on size`);
  }
  if (infraCriticalFiles.length > 0 && !infraCriticalEscalates) {
    contextSignals.push(`touches background tasks or the delivery pipeline lightly (${infraCriticalLines} lines, under the ${INFRA_CRITICAL_MIN_LINES}-line bar for Tier 4)`);
  }
  if (spansLayers && !isCrossLayer) {
    contextSignals.push(`spans packages but only ${prodLines} prod lines — under the ${CROSS_LAYER_MIN_LINES}-line cross-layer bar`);
  }
  if (internalToolingFiles.length > 0) {
    contextSignals.push(`${internalToolingFiles.length} file(s) in private internal-tooling packages, excluded from the line count`);
  }

  return render();
}

module.exports = {
  // Constants needed by the orchestration script
  TIER_LABELS, TIER_INFO,
  // Thresholds (exported for tests and documentation)
  TIER2_MAX_LINES, INFRA_CRITICAL_MIN_LINES, CROSS_LAYER_MIN_LINES,
  TIER4_ESCALATION_LINES, CORE_CRITICAL_GRAZE_LINES, GRAZE_MAX_PROD_LINES,
  // Pure functions
  isTestFile, isTrivialFile, isDocFile, isCriticalFile,
  isSecurityCriticalFile, isCoreCriticalFile, isInfraCriticalFile,
  isInternalToolingFile, isReleaseArtifactFile,
  computeSignals, determineTier, buildTierComment,
};
