'use strict';

// Tests for the pure classification functions in pr-triage-classify.js.
// Uses Node's built-in test runner (no extra dependencies required).
// Run with: node --test .github/scripts/__tests__/pr-triage-classify.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isTestFile, isTrivialFile, isCriticalFile,
  computeSignals, determineTier, buildTierComment,
} = require('../pr-triage-classify');

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Minimal PR object matching the shape returned by the GitHub API */
function makePR(login, ref) {
  return { user: { login }, head: { ref } };
}

/** Minimal file entry matching the shape returned by pulls.listFiles */
function makeFile(filename, additions = 10, deletions = 5) {
  return { filename, additions, deletions };
}

/** Classify a PR end-to-end from raw inputs (the common test path) */
function classify(login, ref, files) {
  return determineTier(computeSignals(makePR(login, ref), files));
}

// ── File classification helpers ──────────────────────────────────────────────

describe('isTestFile', () => {
  it('matches __tests__ directory', () => {
    assert.ok(isTestFile('packages/api/src/__tests__/foo.test.ts'));
    assert.ok(isTestFile('packages/app/src/components/__tests__/Foo.test.tsx'));
  });

  it('matches .test.* and .spec.* extensions', () => {
    assert.ok(isTestFile('packages/app/src/Foo.test.tsx'));
    assert.ok(isTestFile('packages/app/src/Foo.spec.js'));
    assert.ok(isTestFile('packages/api/src/bar.test.ts'));
  });

  it('matches packages/app/tests/ prefix', () => {
    assert.ok(isTestFile('packages/app/tests/e2e/navigation.ts'));
  });

  it('does not match regular source files', () => {
    assert.ok(!isTestFile('packages/api/src/routers/foo.ts'));
    assert.ok(!isTestFile('packages/app/src/App.tsx'));
  });
});

describe('isTrivialFile', () => {
  it('matches docs and images', () => {
    assert.ok(isTrivialFile('README.md'));
    assert.ok(isTrivialFile('docs/setup.txt'));
    assert.ok(isTrivialFile('assets/logo.png'));
    assert.ok(isTrivialFile('assets/icon.svg'));
  });

  it('matches lock files and yarn config', () => {
    assert.ok(isTrivialFile('yarn.lock'));
    assert.ok(isTrivialFile('package-lock.json'));
    assert.ok(isTrivialFile('.yarnrc.yml'));
  });

  it('matches .changeset/ files', () => {
    assert.ok(isTrivialFile('.changeset/some-change.md'));
    assert.ok(isTrivialFile('.changeset/fancy-bears-dance.md'));
  });

  it('matches .env.example and .github/images/', () => {
    assert.ok(isTrivialFile('.env.example'));
    assert.ok(isTrivialFile('.github/images/screenshot.png'));
  });

  it('matches .github/scripts/ files', () => {
    assert.ok(isTrivialFile('.github/scripts/pr-triage.js'));
    assert.ok(isTrivialFile('.github/scripts/pr-triage-classify.js'));
  });

  it('matches .github/workflows/ files', () => {
    assert.ok(isTrivialFile('.github/workflows/pr-triage.yml'));
    assert.ok(isTrivialFile('.github/workflows/knip.yml'));
    // main.yml and release.yml are also trivial per isTrivialFile, but they are
    // caught first by isCriticalFile in computeSignals, so they still → Tier 4
    assert.ok(isTrivialFile('.github/workflows/main.yml'));
  });

  it('does not match production source files', () => {
    assert.ok(!isTrivialFile('packages/app/src/App.tsx'));
    assert.ok(!isTrivialFile('packages/api/src/routers/logs.ts'));
    assert.ok(!isTrivialFile('Makefile'));
    assert.ok(!isTrivialFile('knip.json'));
  });
});

describe('isCriticalFile', () => {
  it('matches auth middleware', () => {
    assert.ok(isCriticalFile('packages/api/src/middleware/auth.ts'));
    assert.ok(isCriticalFile('packages/api/src/middleware/auth/index.ts'));
  });

  it('matches sensitive API routes', () => {
    assert.ok(isCriticalFile('packages/api/src/routers/api/me.ts'));
    assert.ok(isCriticalFile('packages/api/src/routers/api/team.ts'));
    assert.ok(isCriticalFile('packages/api/src/routers/external-api/logs.ts'));
  });

  it('matches core data models', () => {
    assert.ok(isCriticalFile('packages/api/src/models/user.ts'));
    assert.ok(isCriticalFile('packages/api/src/models/team.ts'));
    assert.ok(isCriticalFile('packages/api/src/models/teamInvite.ts'));
  });

  it('matches config, tasks, otel, clickhouse, and core CI workflows', () => {
    assert.ok(isCriticalFile('packages/api/src/config.ts'));
    assert.ok(isCriticalFile('packages/api/src/tasks/alertChecker.ts'));
    assert.ok(isCriticalFile('packages/otel-collector/config.yaml'));
    assert.ok(isCriticalFile('docker/clickhouse/config.xml'));
    assert.ok(isCriticalFile('.github/workflows/main.yml'));
    assert.ok(isCriticalFile('.github/workflows/release.yml'));
  });

  it('does NOT flag non-core workflow files as critical', () => {
    assert.ok(!isCriticalFile('.github/workflows/pr-triage.yml'));
    assert.ok(!isCriticalFile('.github/workflows/knip.yml'));
    assert.ok(!isCriticalFile('.github/workflows/claude.yml'));
  });

  it('matches docker/hyperdx/', () => {
    assert.ok(isCriticalFile('docker/hyperdx/Dockerfile'));
  });

  it('does NOT match non-critical API models', () => {
    assert.ok(!isCriticalFile('packages/api/src/models/alert.ts'));
    assert.ok(!isCriticalFile('packages/api/src/models/dashboard.ts'));
  });

  it('does NOT match regular app and API files', () => {
    assert.ok(!isCriticalFile('packages/app/src/App.tsx'));
    assert.ok(!isCriticalFile('packages/api/src/routers/logs.ts'));
  });

  // Note: isCriticalFile DOES return true for test files under critical paths
  // (e.g. packages/api/src/tasks/tests/util.test.ts). The exclusion happens in
  // computeSignals, which filters test files out before building criticalFiles.
  it('returns true for test files under critical paths (exclusion is in computeSignals)', () => {
    assert.ok(isCriticalFile('packages/api/src/tasks/tests/util.test.ts'));
  });
});

// ── computeSignals ───────────────────────────────────────────────────────────

describe('computeSignals', () => {
  it('separates prod, test, and trivial file line counts', () => {
    const pr = makePR('alice', 'feature/foo');
    const files = [
      makeFile('packages/app/src/Foo.tsx', 20, 5),                     // prod: 25 lines
      makeFile('packages/app/src/__tests__/Foo.test.tsx', 50, 0),      // test: 50 lines
      makeFile('README.md', 2, 1),                                      // trivial: excluded
    ];
    const s = computeSignals(pr, files);
    assert.equal(s.prodFiles.length, 1);
    assert.equal(s.prodLines, 25);
    assert.equal(s.testLines, 50);
  });

  it('excludes changeset files from prod counts', () => {
    const pr = makePR('alice', 'feature/foo');
    const files = [
      makeFile('packages/app/src/Foo.tsx', 20, 5),
      makeFile('.changeset/witty-foxes-run.md', 5, 0),  // trivial
    ];
    const s = computeSignals(pr, files);
    assert.equal(s.prodFiles.length, 1);
    assert.equal(s.prodLines, 25);
  });

  it('detects agent branches by prefix', () => {
    for (const prefix of ['claude/', 'agent/', 'ai/']) {
      const s = computeSignals(makePR('alice', `${prefix}fix-thing`), []);
      assert.ok(s.isAgentBranch, `expected isAgentBranch for prefix "${prefix}"`);
    }
    assert.ok(!computeSignals(makePR('alice', 'feature/normal'), []).isAgentBranch);
  });

  it('detects bot authors', () => {
    assert.ok(computeSignals(makePR('dependabot[bot]', 'dependabot/npm/foo'), []).isBotAuthor);
    assert.ok(!computeSignals(makePR('alice', 'feature/foo'), []).isBotAuthor);
  });

  it('sets allFilesTrivial when every file is trivial', () => {
    const files = [makeFile('README.md'), makeFile('yarn.lock')];
    assert.ok(computeSignals(makePR('alice', 'docs/update'), files).allFilesTrivial);
  });

  it('does not set allFilesTrivial for mixed files', () => {
    const files = [makeFile('README.md'), makeFile('packages/app/src/Foo.tsx')];
    assert.ok(!computeSignals(makePR('alice', 'feat/foo'), files).allFilesTrivial);
  });

  it('detects cross-layer changes (frontend + backend)', () => {
    const files = [
      makeFile('packages/app/src/NewFeature.tsx'),         // frontend
      makeFile('packages/api/src/services/newFeature.ts'), // backend (not models/routers)
    ];
    const s = computeSignals(makePR('alice', 'feat/new'), files);
    assert.ok(s.isCrossLayer);
    assert.ok(s.touchesFrontend);
    assert.ok(s.touchesBackend);
  });

  it('detects cross-layer changes (backend + shared-utils)', () => {
    const files = [
      makeFile('packages/api/src/services/foo.ts'),
      makeFile('packages/common-utils/src/queryParser.ts'),
    ];
    const s = computeSignals(makePR('alice', 'feat/foo'), files);
    assert.ok(s.isCrossLayer);
    assert.ok(s.touchesSharedUtils);
  });

  it('does not flag single-package changes as cross-layer', () => {
    const files = [
      makeFile('packages/app/src/Foo.tsx'),
      makeFile('packages/app/src/Bar.tsx'),
    ];
    assert.ok(!computeSignals(makePR('alice', 'feat/foo'), files).isCrossLayer);
  });

  it('blocks agent branch from Tier 2 when prod lines exceed threshold', () => {
    // 60 prod lines > AGENT_TIER2_MAX_LINES (50)
    const s = computeSignals(makePR('alice', 'claude/feature'), [
      makeFile('packages/app/src/Foo.tsx', 60, 0),
    ]);
    assert.ok(s.agentBlocksTier2);
  });

  it('blocks agent branch from Tier 2 when prod file count exceeds threshold', () => {
    // 5 prod files > AGENT_TIER2_MAX_PROD_FILES (3)
    const files = Array.from({ length: 5 }, (_, i) =>
      makeFile(`packages/app/src/File${i}.tsx`, 5, 2)
    );
    const s = computeSignals(makePR('alice', 'claude/feature'), files);
    assert.ok(s.agentBlocksTier2);
  });

  it('does NOT block agent branch when change is small and focused', () => {
    // 16 prod lines, 1 prod file — well under both thresholds
    const s = computeSignals(makePR('mikeshi', 'claude/fix-mobile-nav'), [
      makeFile('packages/app/src/AppNav.tsx', 11, 5),
    ]);
    assert.ok(!s.agentBlocksTier2);
  });
});

// ── determineTier ────────────────────────────────────────────────────────────

describe('determineTier', () => {
  describe('Tier 1', () => {
    it('bot author', () => {
      assert.equal(classify('dependabot[bot]', 'dependabot/npm/foo', [
        makeFile('package.json', 5, 3),
      ]), 1);
    });

    // package.json is not in TIER1_PATTERNS (it's a production file), but bot
    // author short-circuits to Tier 1 before the trivial-file check fires.
    it('bot author with package.json (non-trivial file) is still Tier 1', () => {
      assert.equal(classify('dependabot[bot]', 'dependabot/npm/lodash', [
        makeFile('package.json', 5, 3),
        makeFile('packages/api/package.json', 2, 2),
      ]), 1);
    });

    it('all trivial files (docs + lock)', () => {
      assert.equal(classify('alice', 'docs/update-readme', [
        makeFile('README.md', 10, 2),
        makeFile('docs/setup.md', 5, 0),
        makeFile('yarn.lock', 100, 80),
      ]), 1);
    });

    it('changeset-only PR', () => {
      assert.equal(classify('alice', 'release/v2.1', [
        makeFile('.changeset/witty-foxes-run.md', 4, 0),
      ]), 1);
    });
  });

  describe('Tier 4', () => {
    it('touches auth middleware', () => {
      assert.equal(classify('alice', 'fix/auth-bug', [
        makeFile('packages/api/src/middleware/auth.ts', 20, 5),
      ]), 4);
    });

    it('touches ClickHouse docker config', () => {
      assert.equal(classify('alice', 'infra/clickhouse-update', [
        makeFile('docker/clickhouse/config.xml', 10, 2),
      ]), 4);
    });

    it('touches main.yml or release.yml', () => {
      assert.equal(classify('alice', 'ci/add-step', [
        makeFile('.github/workflows/main.yml', 15, 3),
      ]), 4);
      assert.equal(classify('alice', 'ci/release-fix', [
        makeFile('.github/workflows/release.yml', 8, 2),
      ]), 4);
    });

    it('non-critical workflow-only changes are Tier 1 (workflow files are trivial)', () => {
      assert.equal(classify('alice', 'ci/add-triage-step', [
        makeFile('.github/workflows/pr-triage.yml', 10, 2),
      ]), 1);
    });

    it('does NOT flag test files under critical paths as Tier 4', () => {
      // e.g. packages/api/src/tasks/tests/util.test.ts should not be critical
      assert.equal(classify('alice', 'feat/alert-tests', [
        makeFile('packages/api/src/tasks/tests/util.test.ts', 40, 0),
        makeFile('packages/api/src/tasks/checkAlerts/tests/checkAlerts.test.ts', 80, 0),
      ]), 2);
    });

    it('touches core user/team models', () => {
      assert.equal(classify('alice', 'feat/user-fields', [
        makeFile('packages/api/src/models/user.ts', 10, 2),
      ]), 4);
    });

    it('escalates Tier 3 human branch past 1000 prod lines', () => {
      assert.equal(classify('alice', 'feat/huge-refactor', [
        makeFile('packages/app/src/BigComponent.tsx', 600, 450),  // 1050 lines
      ]), 4);
    });

    it('escalates Tier 3 agent branch past 400 prod lines (stricter threshold)', () => {
      assert.equal(classify('alice', 'claude/large-feature', [
        makeFile('packages/app/src/BigFeature.tsx', 300, 120),  // 420 lines
      ]), 4);
    });
  });

  describe('Tier 2', () => {
    it('small single-layer frontend change', () => {
      assert.equal(classify('alice', 'fix/button-style', [
        makeFile('packages/app/src/components/Button.tsx', 20, 10),
      ]), 2);
    });

    it('small single-layer backend change (not models/routers)', () => {
      assert.equal(classify('alice', 'fix/service-bug', [
        makeFile('packages/api/src/services/logs.ts', 30, 15),
      ]), 2);
    });

    it('agent branch small enough to qualify (PR #1431 pattern: 1 file, 16 lines)', () => {
      assert.equal(classify('mikeshi', 'claude/fix-mobile-nav', [
        makeFile('packages/app/src/AppNav.tsx', 11, 5),
      ]), 2);
    });

    it('agent branch exactly at file limit (3 prod files, small lines)', () => {
      const files = Array.from({ length: 3 }, (_, i) =>
        makeFile(`packages/app/src/File${i}.tsx`, 10, 5)
      );
      assert.equal(classify('alice', 'claude/small-multi', files), 2);
    });

    it('human branch at 149 prod lines (just under threshold)', () => {
      assert.equal(classify('alice', 'fix/component', [
        makeFile('packages/app/src/Foo.tsx', 100, 49),  // 149 lines
      ]), 2);
    });

    it('agent branch at exactly 49 prod lines qualifies for Tier 2', () => {
      assert.equal(classify('alice', 'claude/fix', [
        makeFile('packages/app/src/Foo.tsx', 49, 0),
      ]), 2);
    });
  });

  describe('Tier 3', () => {
    it('cross-layer change (frontend + backend)', () => {
      assert.equal(classify('alice', 'feat/new-feature', [
        makeFile('packages/app/src/NewFeature.tsx', 30, 5),
        makeFile('packages/api/src/services/newFeature.ts', 40, 10),
      ]), 3);
    });

    it('touches API routes (non-critical)', () => {
      assert.equal(classify('alice', 'feat/new-route', [
        makeFile('packages/api/src/routers/logs.ts', 30, 5),
      ]), 3);
    });

    it('touches API models (non-critical)', () => {
      assert.equal(classify('alice', 'feat/model-field', [
        makeFile('packages/api/src/models/alert.ts', 20, 3),
      ]), 3);
    });

    it('agent branch at exactly 50 prod lines is blocked from Tier 2', () => {
      assert.equal(classify('alice', 'claude/feature', [
        makeFile('packages/app/src/Foo.tsx', 50, 0),  // exactly AGENT_TIER2_MAX_LINES — >= blocks it
      ]), 3);
    });

    it('agent branch over prod-line threshold (60 > 50) → Tier 3, not Tier 2', () => {
      assert.equal(classify('alice', 'claude/medium-feature', [
        makeFile('packages/app/src/Foo.tsx', 60, 0),
      ]), 3);
    });

    it('agent branch over file count threshold (4 files) → Tier 3', () => {
      const files = Array.from({ length: 4 }, (_, i) =>
        makeFile(`packages/app/src/File${i}.tsx`, 10, 5)
      );
      assert.equal(classify('alice', 'claude/big-feature', files), 3);
    });

    it('does NOT escalate agent branch at exactly 400 lines (threshold is exclusive)', () => {
      // prodLines > threshold, not >=, so 400 stays at Tier 3
      assert.equal(classify('alice', 'claude/medium-large', [
        makeFile('packages/app/src/Feature.tsx', 200, 200),  // exactly 400
      ]), 3);
    });

    it('large test additions with small prod change stay Tier 3 (PR #2122 pattern)', () => {
      // Alert threshold PR: 1300 total adds but ~1100 are tests
      const files = [
        makeFile('packages/api/src/services/checkAlerts.ts', 180, 70),       // prod: 250 lines
        makeFile('packages/api/src/__tests__/checkAlerts.test.ts', 1100, 0), // test: excluded
      ];
      // 250 prod lines > TIER2_MAX_LINES (150) → Tier 3, not Tier 4
      assert.equal(classify('alice', 'feat/alert-thresholds', files), 3);
    });

    it('human branch at exactly 150 prod lines is Tier 3, not Tier 2', () => {
      assert.equal(classify('alice', 'fix/component', [
        makeFile('packages/app/src/Foo.tsx', 100, 50),  // exactly TIER2_MAX_LINES — < is exclusive
      ]), 3);
    });

    it('does NOT escalate human branch at exactly 1000 prod lines', () => {
      assert.equal(classify('alice', 'feat/medium-large', [
        makeFile('packages/app/src/Feature.tsx', 500, 500),  // exactly 1000
      ]), 3);
    });
  });
});

// ── buildTierComment ─────────────────────────────────────────────────────────

describe('buildTierComment', () => {
  /** Build a signal object with sensible defaults, overrideable per test */
  function makeSignals(overrides = {}) {
    return {
      author: 'alice',
      branchName: 'feature/foo',
      prodFiles: [makeFile('packages/app/src/Foo.tsx')],
      prodLines: 50,
      testLines: 0,
      criticalFiles: [],
      isAgentBranch: false,
      isBotAuthor: false,
      allFilesTrivial: false,
      touchesApiModels: false,
      touchesFrontend: true,
      touchesBackend: false,
      touchesSharedUtils: false,
      isCrossLayer: false,
      agentBlocksTier2: false,
      ...overrides,
    };
  }

  it('always includes the pr-triage sentinel marker', () => {
    assert.ok(buildTierComment(2, makeSignals()).includes('<!-- pr-triage -->'));
  });

  it('includes the correct headline for each tier', () => {
    assert.ok(buildTierComment(1, makeSignals()).includes('Tier 1'));
    assert.ok(buildTierComment(2, makeSignals()).includes('Tier 2'));
    assert.ok(buildTierComment(3, makeSignals()).includes('Tier 3'));
    assert.ok(buildTierComment(4, makeSignals()).includes('Tier 4'));
  });

  it('includes override instructions with the correct tier label', () => {
    const body = buildTierComment(3, makeSignals());
    assert.ok(body.includes('review/tier-3'));
    assert.ok(body.includes('Manual overrides are preserved'));
  });

  it('lists critical files when present', () => {
    const signals = makeSignals({
      criticalFiles: [makeFile('packages/api/src/middleware/auth.ts')],
    });
    const body = buildTierComment(4, signals);
    assert.ok(body.includes('Critical-path files'));
    assert.ok(body.includes('auth.ts'));
  });

  it('explains cross-layer trigger with which layers are involved', () => {
    const signals = makeSignals({
      isCrossLayer: true,
      touchesFrontend: true,
      touchesBackend: true,
      touchesSharedUtils: false,
    });
    const body = buildTierComment(3, signals);
    assert.ok(body.includes('Cross-layer change'));
    assert.ok(body.includes('packages/app'));
    assert.ok(body.includes('packages/api'));
  });

  it('explains API model/route trigger', () => {
    const body = buildTierComment(3, makeSignals({ touchesApiModels: true }));
    assert.ok(body.includes('API routes or data models'));
  });

  it('explains agent branch bump to Tier 3', () => {
    const signals = makeSignals({
      isAgentBranch: true,
      agentBlocksTier2: true,
      branchName: 'claude/big-feature',
      prodLines: 80,
      prodFiles: Array.from({ length: 5 }, (_, i) => makeFile(`packages/app/src/File${i}.tsx`)),
    });
    const body = buildTierComment(3, signals);
    assert.ok(body.includes('bumped to Tier 3'));
  });

  it('notes when agent branch is small enough for Tier 2', () => {
    const signals = makeSignals({
      isAgentBranch: true,
      agentBlocksTier2: false,
      branchName: 'claude/tiny-fix',
    });
    const body = buildTierComment(2, signals);
    assert.ok(body.includes('small enough to qualify for Tier 2'));
  });

  it('shows test line count in stats when non-zero', () => {
    const body = buildTierComment(2, makeSignals({ testLines: 200 }));
    assert.ok(body.includes('200 in test files'));
  });

  it('omits test line note when testLines is 0', () => {
    const body = buildTierComment(2, makeSignals({ testLines: 0 }));
    assert.ok(!body.includes('test files'));
  });

  it('includes a catch-all trigger for standard Tier 3 PRs with no specific signals', () => {
    const body = buildTierComment(3, makeSignals());
    assert.ok(body.includes('Standard feature/fix'));
  });

  it('includes bot-author trigger for Tier 1 bot PRs', () => {
    const body = buildTierComment(1, makeSignals({ isBotAuthor: true, author: 'dependabot[bot]' }));
    assert.ok(body.includes('Bot author'));
  });
});
