'use strict';

// ── File classification patterns ─────────────────────────────────────────────
const TIER4_PATTERNS = [
  /^packages\/api\/src\/middleware\/auth/,
  /^packages\/api\/src\/routers\/api\/me\./,
  /^packages\/api\/src\/routers\/api\/team\./,
  /^packages\/api\/src\/routers\/external-api\//,
  /^packages\/api\/src\/models\/(user|team|teamInvite)\./,
  /^packages\/api\/src\/config\./,
  /^packages\/api\/src\/tasks\//,
  /^packages\/otel-collector\//,
  /^docker\/otel-collector\//,
  /^docker\/clickhouse\//,
  /^\.github\/workflows\/(main|release)\.yml$/,
];

const TIER1_PATTERNS = [
  /\.(md|txt|png|jpg|jpeg|gif|svg|ico)$/i,
  /^yarn\.lock$/,
  /^package-lock\.json$/,
  /^\.yarnrc\.yml$/,
  /^\.github\/images\//,
  /^\.env\.example$/,
  /^\.changeset\//,  // version-bump config files; no functional code
];

const TEST_FILE_PATTERNS = [
  /\/__tests__\//,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /^packages\/app\/tests\//,
];

// ── Thresholds (all line counts exclude test and trivial files) ───────────────
const TIER2_MAX_LINES = 150;           // max prod lines eligible for Tier 2
const TIER4_ESCALATION_HUMAN = 1000;   // Tier 3 → 4 for human branches
const TIER4_ESCALATION_AGENT = 400;    // Tier 3 → 4 for agent branches (stricter)

// Agent branches can reach Tier 2 only for very small, focused changes
const AGENT_TIER2_MAX_LINES = 50;
const AGENT_TIER2_MAX_PROD_FILES = 3;

// ── Other constants ──────────────────────────────────────────────────────────
const BOT_AUTHORS = ['dependabot', 'dependabot[bot]'];
const AGENT_BRANCH_PREFIXES = ['claude/', 'agent/', 'ai/'];

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
    detail: 'Docs, images, lock files, or a dependency bump. No functional code changes detected.',
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
    detail: 'Touches auth, data models, config, tasks, OTel pipeline, ClickHouse, or CI/CD.',
    process: 'Deep review from a domain expert. Synchronous walkthrough may be required.',
    sla: 'Schedule synchronous review within 2 business days.',
  },
};

// ── File classification helpers ──────────────────────────────────────────────
const isTestFile    = f => TEST_FILE_PATTERNS.some(p => p.test(f));
const isTrivialFile = f => TIER1_PATTERNS.some(p => p.test(f));
const isCriticalFile = f => TIER4_PATTERNS.some(p => p.test(f));

// ── Signal computation ───────────────────────────────────────────────────────
// Returns a flat object of all facts needed for tier determination and comment
// generation. All derived from PR metadata + file list — no GitHub API calls.
//
// @param {object} pr       - GitHub PR object: { user: { login }, head: { ref } }
// @param {Array}  filesRes - GitHub files array: [{ filename, additions, deletions }]
function computeSignals(pr, filesRes) {
  const author     = pr.user.login;
  const branchName = pr.head.ref;

  const testFiles     = filesRes.filter(f => isTestFile(f.filename));
  const prodFiles     = filesRes.filter(f => !isTestFile(f.filename) && !isTrivialFile(f.filename));
  const criticalFiles = filesRes.filter(f => isCriticalFile(f.filename) && !isTestFile(f.filename));

  const prodLines = prodFiles.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const testLines = testFiles.reduce((sum, f) => sum + f.additions + f.deletions, 0);

  const isAgentBranch   = AGENT_BRANCH_PREFIXES.some(p => branchName.startsWith(p));
  const isBotAuthor     = BOT_AUTHORS.includes(author);
  const allFilesTrivial = filesRes.length > 0 && filesRes.every(f => isTrivialFile(f.filename));

  // Blocks Tier 2 — API models and routes carry implicit cross-cutting risk
  const touchesApiModels = prodFiles.some(f =>
    f.filename.startsWith('packages/api/src/models/') ||
    f.filename.startsWith('packages/api/src/routers/')
  );

  // Cross-layer: production changes spanning multiple monorepo packages
  const touchesFrontend    = prodFiles.some(f => f.filename.startsWith('packages/app/'));
  const touchesBackend     = prodFiles.some(f => f.filename.startsWith('packages/api/'));
  const touchesSharedUtils = prodFiles.some(f => f.filename.startsWith('packages/common-utils/'));
  const isCrossLayer = [touchesFrontend, touchesBackend, touchesSharedUtils].filter(Boolean).length >= 2;

  // Agent branches can reach Tier 2 only when the change is very small and focused
  const agentBlocksTier2 = isAgentBranch &&
    (prodLines >= AGENT_TIER2_MAX_LINES || prodFiles.length > AGENT_TIER2_MAX_PROD_FILES);

  return {
    author, branchName,
    prodFiles, prodLines, testLines, criticalFiles,
    isAgentBranch, isBotAuthor, allFilesTrivial,
    touchesApiModels, touchesFrontend, touchesBackend, touchesSharedUtils,
    isCrossLayer, agentBlocksTier2,
  };
}

// ── Tier determination ───────────────────────────────────────────────────────
// @param {object} signals - output of computeSignals()
// @returns {number} tier  - 1 | 2 | 3 | 4
function determineTier(signals) {
  const {
    criticalFiles, isBotAuthor, allFilesTrivial,
    prodLines, touchesApiModels, isCrossLayer, agentBlocksTier2, isAgentBranch,
  } = signals;

  // Tier 4: touches critical infrastructure (auth, config, pipeline, CI/CD)
  if (criticalFiles.length > 0) return 4;

  // Tier 1: bot-authored or only docs/images/lock files changed
  if (isBotAuthor || allFilesTrivial) return 1;

  // Tier 2: small, isolated, single-layer change
  //   Agent branches qualify when the change is very small and focused
  //   (agentBlocksTier2 is false when under AGENT_TIER2_MAX_LINES / MAX_PROD_FILES)
  const qualifiesForTier2 =
    prodLines < TIER2_MAX_LINES &&
    !touchesApiModels &&
    !isCrossLayer &&
    !agentBlocksTier2;
  if (qualifiesForTier2) return 2;

  // Tier 3: everything else — escalate very large diffs to Tier 4
  const sizeThreshold = isAgentBranch ? TIER4_ESCALATION_AGENT : TIER4_ESCALATION_HUMAN;
  return prodLines > sizeThreshold ? 4 : 3;
}

// ── Comment generation ───────────────────────────────────────────────────────
// @param {number} tier    - 1 | 2 | 3 | 4
// @param {object} signals - output of computeSignals()
// @returns {string}       - Markdown comment body
function buildTierComment(tier, signals) {
  const {
    author, branchName,
    prodFiles, prodLines, testLines, criticalFiles,
    isAgentBranch, isBotAuthor, allFilesTrivial,
    touchesApiModels, touchesFrontend, touchesBackend, touchesSharedUtils,
    isCrossLayer, agentBlocksTier2,
  } = signals;

  const info = TIER_INFO[tier];
  const sizeThreshold = isAgentBranch ? TIER4_ESCALATION_AGENT : TIER4_ESCALATION_HUMAN;

  // Primary triggers — the specific reasons this tier was assigned
  const triggers = [];
  if (criticalFiles.length > 0) {
    triggers.push(`**Critical-path files** (${criticalFiles.length}):\n${criticalFiles.map(f => `    - \`${f.filename}\``).join('\n')}`);
  }
  if (tier === 4 && prodLines > sizeThreshold && criticalFiles.length === 0) {
    triggers.push(`**Large diff**: ${prodLines} production lines changed (threshold: ${sizeThreshold})`);
  }
  if (isBotAuthor) triggers.push(`**Bot author**: \`${author}\``);
  if (allFilesTrivial && !isBotAuthor) triggers.push('**All files are docs / images / lock files**');
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
  if (isAgentBranch && agentBlocksTier2 && tier <= 3) {
    triggers.push(`**Agent-generated branch** (\`${branchName}\`) with ${prodLines} prod lines across ${prodFiles.length} files — bumped to Tier 3 for mandatory human review`);
  }
  if (triggers.length === 0) {
    triggers.push('**Standard feature/fix** — introduces new logic or modifies core functionality');
  }

  // Informational context — didn't drive the tier on their own
  const contextSignals = [];
  if (isAgentBranch && !agentBlocksTier2 && tier === 2) {
    contextSignals.push(`agent branch (\`${branchName}\`) — change small enough to qualify for Tier 2`);
  } else if (isAgentBranch && tier === 4) {
    contextSignals.push(`agent branch (\`${branchName}\`)`);
  }

  const triggerSection = `\n**Why this tier:**\n${triggers.map(t => `- ${t}`).join('\n')}`;
  const contextSection = contextSignals.length > 0
    ? `\n**Additional context:** ${contextSignals.join(', ')}`
    : '';

  return [
    '<!-- pr-triage -->',
    `## ${info.emoji} ${info.headline}`,
    '',
    info.detail,
    triggerSection,
    contextSection,
    '',
    `**Review process**: ${info.process}`,
    `**SLA**: ${info.sla}`,
    '',
    '<details><summary>Stats</summary>',
    '',
    `- Production files changed: ${prodFiles.length}`,
    `- Production lines changed: ${prodLines}${testLines > 0 ? ` (+ ${testLines} in test files, excluded from tier calculation)` : ''}`,
    `- Branch: \`${branchName}\``,
    `- Author: ${author}`,
    '',
    '</details>',
    '',
    `> To override this classification, remove the \`${TIER_LABELS[tier].name}\` label and apply a different \`review/tier-*\` label. Manual overrides are preserved on subsequent pushes.`,
  ].join('\n');
}

module.exports = {
  // Constants needed by the orchestration script
  TIER_LABELS, TIER_INFO,
  // Pure functions
  isTestFile, isTrivialFile, isCriticalFile,
  computeSignals, determineTier, buildTierComment,
};
