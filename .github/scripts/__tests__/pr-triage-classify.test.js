'use strict';

// Tests for the pure classification functions in pr-triage-classify.js.
// Uses Node's built-in test runner (no extra dependencies required).
// Run with: node --test .github/scripts/__tests__/pr-triage-classify.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isTestFile, isTrivialFile, isCriticalFile,
  isSecurityCriticalFile, isCoreCriticalFile, isInfraCriticalFile,
  isInternalToolingFile, isReleaseArtifactFile,
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

  it('matches the E2E-only ClickHouse fixture, but not its shipped siblings', () => {
    assert.ok(isTestFile('docker/clickhouse/local/init-db-e2e.sh'));
    // config.xml / users.xml are copied into the all-in-one image — production config
    assert.ok(!isTestFile('docker/clickhouse/local/config.xml'));
    assert.ok(!isTestFile('docker/clickhouse/local/users.xml'));
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

describe('critical-path bands', () => {
  it('classifies auth and input validation as security-critical', () => {
    for (const f of [
      'packages/api/src/middleware/auth.ts',
      'packages/api/src/middleware/auth/index.ts',
      'packages/api/src/utils/validators.ts',
    ]) {
      assert.ok(isSecurityCriticalFile(f), `expected security-critical: ${f}`);
    }
  });

  it('classifies tenancy, public API and shipped DB config as core-critical', () => {
    for (const f of [
      'packages/api/src/routers/api/me.ts',
      'packages/api/src/routers/external-api/v2/dashboards.ts',
      'packages/api/src/models/user.ts',
      'packages/api/src/config.ts',
      'docker/clickhouse/local/users.xml',
    ]) {
      assert.ok(isCoreCriticalFile(f), `expected core-critical: ${f}`);
      assert.ok(!isSecurityCriticalFile(f), `expected not security-critical: ${f}`);
      assert.ok(!isInfraCriticalFile(f), `expected not infra-critical: ${f}`);
    }
  });

  it('classifies build and deploy plumbing as infra-critical', () => {
    for (const f of [
      'packages/api/src/tasks/checkAlerts/index.ts',
      'packages/otel-collector/package.json',
      'docker/otel-collector/schema/seed/00006_otel_logs_rollups.sql',
      'docker/hyperdx/Dockerfile',
      '.github/workflows/main.yml',
    ]) {
      assert.ok(isInfraCriticalFile(f), `expected infra-critical: ${f}`);
      assert.ok(!isSecurityCriticalFile(f), `expected not security-critical: ${f}`);
      assert.ok(!isCoreCriticalFile(f), `expected not core-critical: ${f}`);
    }
  });

  it('isCriticalFile still matches either list (path-level check)', () => {
    assert.ok(isCriticalFile('packages/api/src/middleware/auth.ts'));
    assert.ok(isCriticalFile('docker/hyperdx/Dockerfile'));
    assert.ok(!isCriticalFile('packages/app/src/App.tsx'));
  });
});

describe('isInternalToolingFile', () => {
  it('matches the private hdx-eval package only', () => {
    assert.ok(isInternalToolingFile('packages/hdx-eval/src/grade.ts'));
    assert.ok(!isInternalToolingFile('packages/app/src/App.tsx'));
    assert.ok(!isInternalToolingFile('packages/api/src/services/logs.ts'));
  });
});

describe('isReleaseArtifactFile', () => {
  it('matches the files a changesets release PR touches', () => {
    for (const f of [
      '.changeset/witty-foxes-run.md',
      'packages/app/CHANGELOG.md',
      'packages/api/package.json',
      'package.json',
      'yarn.lock',
      '.env',
    ]) {
      assert.ok(isReleaseArtifactFile(f), `expected release artifact: ${f}`);
    }
  });

  it('does not match source files', () => {
    assert.ok(!isReleaseArtifactFile('packages/app/src/App.tsx'));
    assert.ok(!isReleaseArtifactFile('packages/api/src/middleware/auth.ts'));
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

  it('detects cross-layer changes (frontend + backend) above the line floor', () => {
    const files = [
      makeFile('packages/app/src/NewFeature.tsx', 60, 10),         // frontend
      makeFile('packages/api/src/services/newFeature.ts', 40, 20), // backend (not models/routers)
    ];
    const s = computeSignals(makePR('alice', 'feat/new'), files);  // 130 prod lines
    assert.ok(s.isCrossLayer);
    assert.ok(s.spansLayers);
    assert.ok(s.touchesFrontend);
    assert.ok(s.touchesBackend);
  });

  it('detects cross-layer changes (backend + shared-utils)', () => {
    const files = [
      makeFile('packages/api/src/services/foo.ts', 70, 10),
      makeFile('packages/common-utils/src/queryParser.ts', 30, 10),
    ];
    const s = computeSignals(makePR('alice', 'feat/foo'), files);  // 120 prod lines
    assert.ok(s.isCrossLayer);
    assert.ok(s.touchesSharedUtils);
  });

  it('spans packages but stays below CROSS_LAYER_MIN_LINES', () => {
    // A small fix that happens to cross a package boundary is not architectural risk
    const files = [
      makeFile('packages/app/src/Foo.tsx', 8, 4),
      makeFile('packages/api/src/services/foo.ts', 6, 4),
    ];
    const s = computeSignals(makePR('alice', 'fix/small'), files);  // 22 prod lines
    assert.ok(s.spansLayers, 'still spans two packages');
    assert.ok(!s.isCrossLayer, 'but is under the line floor');
  });

  it('does not flag single-package changes as cross-layer', () => {
    const files = [
      makeFile('packages/app/src/Foo.tsx'),
      makeFile('packages/app/src/Bar.tsx'),
    ];
    assert.ok(!computeSignals(makePR('alice', 'feat/foo'), files).isCrossLayer);
  });

  it('derives identical signals regardless of branch name', () => {
    // Branch naming carries no weight: agent-authored PRs are judged on the same
    // evidence as anyone else's. Keying off a `claude/` prefix only penalised the
    // tools that advertise themselves.
    const files = [makeFile('packages/app/src/Foo.tsx', 120, 30)];
    const baseline = computeSignals(makePR('alice', 'feat/thing'), files);
    for (const ref of ['claude/thing', 'agent/thing', 'ai/thing', 'cursor/thing']) {
      const s = computeSignals(makePR('alice', ref), files);
      assert.deepEqual(
        { ...s, branchName: null },
        { ...baseline, branchName: null },
        `branch "${ref}" should not change any signal`
      );
    }
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

    it('automated changesets release PR (PR #2683 pattern)', () => {
      // The two-line otel-collector version bump used to read as a critical change
      assert.equal(classify('github-actions', 'changeset-release/main', [
        makeFile('.changeset/bright-histograms-toggle.md', 0, 5),
        makeFile('packages/app/CHANGELOG.md', 82, 0),
        makeFile('packages/app/package.json', 2, 2),
        makeFile('packages/otel-collector/CHANGELOG.md', 2, 0),
        makeFile('packages/otel-collector/package.json', 1, 1),
        makeFile('yarn.lock', 8, 0),
        makeFile('.env', 2, 2),
      ]), 1);
    });

    it('release branch carrying real source code is NOT short-circuited', () => {
      // Deliberately non-critical code: an auth.ts case would pass even if the
      // release guard were deleted, since auth is Tier 4 either way.
      assert.notEqual(classify('github-actions', 'changeset-release/main', [
        makeFile('packages/otel-collector/package.json', 1, 1),
        makeFile('packages/app/src/App.tsx', 600, 300),  // not a release artifact
      ]), 1);
    });

    it('github-actions gets no blanket bot escape — only the release path', () => {
      // .github/workflows/claude.yml runs with secrets.GITHUB_TOKEN, so PRs the
      // agent opens are authored by github-actions. A blanket bot escape would
      // drop a 900-line agent PR to Tier 1 auto-merge.
      const files = [makeFile('packages/app/src/App.tsx', 600, 300)];
      assert.equal(classify('github-actions', 'chore/codegen', files), 3);
      assert.equal(classify('github-actions[bot]', 'chore/codegen', files), 3);
      assert.equal(
        classify('github-actions', 'chore/codegen', files),
        classify('alice', 'chore/codegen', files),
        'a bot-authored PR must tier the same as the identical human one'
      );
    });

    it('dependabot keeps its blanket escape', () => {
      assert.equal(classify('dependabot[bot]', 'dependabot/npm/lodash', [
        makeFile('package.json', 5, 3),
        makeFile('packages/api/package.json', 2, 2),
      ]), 1);
    });

    it('release-artifact files outside a release branch classify normally', () => {
      assert.equal(classify('alice', 'chore/bump-collector', [
        makeFile('packages/otel-collector/package.json', 40, 10),  // 50 lines of infra churn
      ]), 4);
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

    it('substantially rewrites main.yml or release.yml', () => {
      assert.equal(classify('alice', 'ci/add-step', [
        makeFile('.github/workflows/main.yml', 30, 5),  // 35 lines, over the infra bar
      ]), 4);
      assert.equal(classify('alice', 'ci/release-fix', [
        makeFile('.github/workflows/release.yml', 25, 10),  // 35 lines
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

    it('escalates Tier 3 past 1000 prod lines', () => {
      assert.equal(classify('alice', 'feat/huge-refactor', [
        makeFile('packages/app/src/BigComponent.tsx', 600, 450),  // 1050 lines
      ]), 4);
    });

    it('applies the same size bar to an agent-named branch', () => {
      assert.equal(classify('alice', 'claude/large-feature', [
        makeFile('packages/app/src/BigFeature.tsx', 300, 120),  // 420 lines — Tier 3, not 4
      ]), 3);
      assert.equal(classify('alice', 'claude/huge-feature', [
        makeFile('packages/app/src/BigFeature.tsx', 600, 450),  // 1050 lines
      ]), 4);
    });

    it('security-critical paths escalate at any size, with no graze escape', () => {
      // A one-line auth change can invert an authorisation check
      assert.equal(classify('alice', 'fix/rate-limiter', [
        makeFile('packages/api/src/middleware/auth.ts', 1, 0),
      ]), 4);
      assert.equal(classify('alice', 'fix/validator', [
        makeFile('packages/api/src/utils/validators.ts', 1, 1),
      ]), 4);
    });

    it('core-critical paths escalate when the PR is not tiny', () => {
      // 3 core-critical lines, but a 150-line PR overall — still Tier 4
      assert.equal(classify('alice', 'feat/series-table', [
        makeFile('packages/api/src/models/team.ts', 2, 1),
        makeFile('packages/app/src/Settings.tsx', 100, 47),
      ]), 4);
    });

    it('catches a security fix whose critical content is in a shared validator (PR #2593)', () => {
      // The SSRF guard itself lives in utils/validators.ts; only 19 lines landed
      // under checkAlerts, which is below the infra bar. Without validators on
      // the always-critical list this fix would fall through to Tier 3.
      assert.equal(classify('alice', 'fix/webhook-ssrf-guard', [
        makeFile('packages/api/src/utils/validators.ts', 45, 15),
        makeFile('packages/api/src/routers/api/clickhouseProxy.ts', 14, 5),
        makeFile('packages/api/src/tasks/checkAlerts/template.ts', 14, 5),
      ]), 4);
    });

    it('does NOT escalate a light touch on an infra-critical path (PR #2684 pattern)', () => {
      // A Help-menu feature that incidentally edits three lines of Dockerfile
      assert.equal(classify('alice', 'feat/changelog-viewer', [
        makeFile('docker/hyperdx/Dockerfile', 2, 1),
        makeFile('packages/app/src/HelpMenu.tsx', 100, 24),
      ]), 2);
    });

    it('escalates once infra-critical churn reaches the bar', () => {
      assert.equal(classify('alice', 'infra/collector-config', [
        makeFile('docker/otel-collector/config.yaml', 25, 5),  // exactly 30
      ]), 4);
      assert.equal(classify('alice', 'infra/collector-config', [
        makeFile('docker/otel-collector/config.yaml', 20, 9),  // 29 — just under
      ]), 2);
    });

    it('aggregates infra churn across files (PR #2668 pattern)', () => {
      // 47 lines across three checkAlerts files: no single file clears the bar,
      // but the change as a whole does. A per-file check would let this through
      // as Tier 2 — it is a webhook-redirect security fix.
      assert.equal(classify('alice', 'fix/webhook-redirects', [
        makeFile('packages/api/src/tasks/checkAlerts/errors.ts', 10, 3),
        makeFile('packages/api/src/tasks/checkAlerts/index.ts', 20, 4),
        makeFile('packages/api/src/tasks/checkAlerts/template.ts', 8, 2),
      ]), 4);
    });

    it('docs under a critical path never escalate', () => {
      assert.equal(classify('alice', 'docs/collector-readme', [
        makeFile('packages/otel-collector/README.md', 60, 20),
      ]), 1);
    });

    it('the E2E ClickHouse fixture does not escalate (PR #2771 pattern)', () => {
      assert.equal(classify('alice', 'fix/distributed-table-errors', [
        makeFile('docker/clickhouse/local/init-db-e2e.sh', 20, 11),
        makeFile('packages/app/src/SourceForm.tsx', 40, 18),
      ]), 2);
    });

    it('but shipped ClickHouse config escalates once past the graze bounds', () => {
      assert.equal(classify('alice', 'infra/ch-users', [
        makeFile('docker/clickhouse/local/users.xml', 15, 8),  // 23 lines, over the graze line
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

    it('small focused change on an agent branch (PR #1431 pattern: 1 file, 16 lines)', () => {
      assert.equal(classify('mikeshi', 'claude/fix-mobile-nav', [
        makeFile('packages/app/src/AppNav.tsx', 11, 5),
      ]), 2);
    });

    it('at 249 prod lines (just under threshold)', () => {
      assert.equal(classify('alice', 'fix/component', [
        makeFile('packages/app/src/Foo.tsx', 200, 49),  // 249 lines
      ]), 2);
    });

    it('focused new UI component at 238 prod lines qualifies for Tier 2 (PR #2175 pattern)', () => {
      assert.equal(classify('mikeshi', 'cursor/add-feedback-widget', [
        makeFile('packages/app/src/components/AppNav/AppNavFeedback.tsx', 217, 0),
        makeFile('packages/app/src/components/AppNav/AppNav.module.scss', 17, 0),
        makeFile('packages/app/src/components/AppNav/AppNav.tsx', 4, 0),
      ]), 2);
    });

    it('a 200-line agent-named branch is Tier 2, same as any other branch', () => {
      const files = [makeFile('packages/app/src/Feature.tsx', 160, 40)];  // 200 lines, 1 file
      for (const ref of ['feat/thing', 'claude/thing', 'agent/thing', 'ai/thing']) {
        assert.equal(classify('alice', ref, files), 2, `branch "${ref}"`);
      }
    });

    it('a tiny PR that merely grazes a core-critical path is tiered on size', () => {
      // 1 line in config.ts inside a 3-line PR (PR #2266 pattern). Across 600
      // merged PRs this cohort drew substantive comments at the same rate as
      // PRs touching no critical path at all.
      assert.equal(classify('alice', 'chore/config-default', [
        makeFile('packages/api/src/config.ts', 1, 0),
        makeFile('packages/api/src/services/foo.ts', 1, 1),
      ]), 2);
    });

    it('grazing does not bypass the API models/routers rule — those land at Tier 3', () => {
      // Falling out of Tier 4 does not mean falling all the way to a skim: the
      // pre-existing models/routers block still forces a full human review.
      assert.equal(classify('alice', 'chore/typo', [
        makeFile('packages/api/src/models/user.ts', 1, 0),          // PR #2397 pattern
      ]), 3);
      assert.equal(classify('alice', 'fix/alerts-field', [
        makeFile('packages/api/src/routers/external-api/v2/alerts.ts', 7, 3),
        makeFile('packages/api/src/services/alerts.ts', 12, 4),     // PR #2595 pattern
      ]), 3);
    });

    it('grazing counts churn in buckets excluded from prodLines', () => {
      // Workflows, Actions scripts and hdx-eval are excluded from prodLines for
      // tiering, but they are still code a reviewer has to read — they must not
      // let a large PR pass itself off as a graze.
      assert.equal(classify('alice', 'infra/ch-and-ci', [
        makeFile('docker/clickhouse/local/users.xml', 3, 2),
        makeFile('.github/workflows/deploy-staging.yml', 700, 0),
      ]), 4);
      assert.equal(classify('alice', 'feat/evals-and-config', [
        makeFile('packages/api/src/config.ts', 3, 2),
        makeFile('packages/hdx-eval/src/big.ts', 5000, 0),
      ]), 4);
      // Lockfile churn is unreadable and does not count against a graze
      assert.equal(classify('alice', 'chore/bump', [
        makeFile('packages/api/src/config.ts', 3, 2),
        makeFile('yarn.lock', 4000, 3000),
      ]), 2);
    });

    it('grazing stops at the bounds — either bound alone is not enough', () => {
      // 11 core-critical lines: over the graze line, small PR or not
      assert.equal(classify('alice', 'fix/a', [
        makeFile('packages/api/src/models/user.ts', 8, 3),
      ]), 4);
      // 51 production lines: PR is no longer tiny, so the graze does not apply
      assert.equal(classify('alice', 'fix/b', [
        makeFile('packages/api/src/models/user.ts', 1, 0),
        makeFile('packages/app/src/Foo.tsx', 40, 10),
      ]), 4);
    });

    it('grazing never applies to a security-critical path', () => {
      // Same shape as the graze cases, but auth — stays Tier 4 (PR #2781 pattern)
      assert.equal(classify('alice', 'fix/rate-limiter-key', [
        makeFile('packages/api/src/middleware/auth.ts', 7, 3),
        makeFile('packages/api/src/utils/rateLimit.ts', 3, 1),
      ]), 4);
    });

    it('evals-only PR is Tier 2, not Tier 1 — private package, but still reviewed', () => {
      assert.equal(classify('alice', 'feat/eval-metrics', [
        makeFile('packages/hdx-eval/src/scenarios/metrics.ts', 500, 120),
        makeFile('packages/hdx-eval/src/grade.ts', 200, 30),
      ]), 2);
    });

    it('hdx-eval lines do not push a product change over the Tier 2 ceiling', () => {
      assert.equal(classify('alice', 'feat/eval-and-app', [
        makeFile('packages/hdx-eval/src/grade.ts', 600, 100),  // excluded from the count
        makeFile('packages/app/src/Foo.tsx', 30, 10),          // 40 prod lines
      ]), 2);
    });
  });

  describe('Tier 3', () => {
    it('cross-layer change (frontend + backend) above the line floor', () => {
      assert.equal(classify('alice', 'feat/new-feature', [
        makeFile('packages/app/src/NewFeature.tsx', 60, 5),
        makeFile('packages/api/src/services/newFeature.ts', 40, 10),
      ]), 3);  // 115 prod lines, over CROSS_LAYER_MIN_LINES
    });

    it('cross-layer change below the line floor drops to Tier 2 (PR #2707 pattern)', () => {
      assert.equal(classify('alice', 'fix/histogram-grouping', [
        makeFile('packages/app/src/Chart.tsx', 10, 4),
        makeFile('packages/common-utils/src/renderChartConfig.ts', 6, 2),
      ]), 2);  // 22 prod lines
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

    it('large test additions with small prod change stay Tier 3 (PR #2122 pattern)', () => {
      // Alert threshold PR: test lines are excluded, so only prod churn decides
      const files = [
        makeFile('packages/api/src/services/checkAlerts.ts', 300, 120),      // prod: 420 lines
        makeFile('packages/api/src/__tests__/checkAlerts.test.ts', 1100, 0), // test: excluded
      ];
      // 420 prod lines >= TIER2_MAX_LINES (250) → Tier 3, and well under the 1000 Tier 4 bar
      assert.equal(classify('alice', 'feat/alert-thresholds', files), 3);
    });

    it('at exactly 250 prod lines is Tier 3, not Tier 2', () => {
      assert.equal(classify('alice', 'fix/component', [
        makeFile('packages/app/src/Foo.tsx', 150, 100),  // exactly TIER2_MAX_LINES — < is exclusive
      ]), 3);
    });

    it('does NOT escalate at exactly 1000 prod lines', () => {
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
      securityCriticalFiles: [],
      coreCriticalFiles: [],
      coreCriticalLines: 0,
      grazesCoreCritical: false,
      infraCriticalFiles: [],
      infraCriticalLines: 0,
      infraCriticalEscalates: false,
      internalToolingFiles: [],
      isBotAuthor: false,
      allFilesTrivial: false,
      isReleaseArtifactPR: false,
      touchesApiModels: false,
      touchesFrontend: true,
      touchesBackend: false,
      touchesSharedUtils: false,
      spansLayers: false,
      isCrossLayer: false,
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
    const criticalFiles = [makeFile('packages/api/src/middleware/auth.ts')];
    const body = buildTierComment(4, makeSignals({ criticalFiles, securityCriticalFiles: criticalFiles }));
    assert.ok(body.includes('Security-critical files'));
    assert.ok(body.includes('auth.ts'));
  });

  it('explains a graze as context rather than a trigger', () => {
    const coreCriticalFiles = [makeFile('packages/api/src/config.ts', 1, 0)];
    const body = buildTierComment(2, makeSignals({
      coreCriticalFiles, coreCriticalLines: 1, grazesCoreCritical: true, prodLines: 3,
    }));
    assert.ok(body.includes('grazes a critical path'));
    assert.ok(!body.includes('Critical-path files'), 'a graze must not read as an escalation');
  });

  it('distinguishes a substantial pipeline change from a critical-path file', () => {
    const infraCriticalFiles = [makeFile('docker/hyperdx/Dockerfile', 30, 10)];
    const body = buildTierComment(4, makeSignals({
      criticalFiles: infraCriticalFiles,
      infraCriticalFiles,
      infraCriticalLines: 40,
      infraCriticalEscalates: true,
    }));
    assert.ok(body.includes('delivery pipeline substantially modified'));
    assert.ok(body.includes('40 lines'));
    assert.ok(!body.includes('Critical-path files'), 'no always-critical files were touched');
  });

  it('notes a light pipeline touch as context rather than a trigger', () => {
    const body = buildTierComment(2, makeSignals({
      infraCriticalFiles: [makeFile('docker/hyperdx/Dockerfile', 2, 1)],
      infraCriticalLines: 3,
      infraCriticalEscalates: false,
    }));
    assert.ok(body.includes('delivery pipeline lightly'));
    assert.ok(!body.includes('substantially modified'));
  });

  it('explains an automated release PR', () => {
    const body = buildTierComment(1, makeSignals({
      isReleaseArtifactPR: true,
      isBotAuthor: true,
      author: 'github-actions',
      branchName: 'changeset-release/main',
      // Signals a real release PR carries — none of it is actionable, so the
      // comment should stay quiet about them.
      infraCriticalFiles: [makeFile('packages/otel-collector/package.json', 1, 1)],
      infraCriticalLines: 2,
      internalToolingFiles: [makeFile('packages/hdx-eval/package.json', 1, 1)],
      spansLayers: true,
    }));
    assert.ok(body.includes('Automated release'));
    assert.ok(!body.includes('Bot author'), 'release framing supersedes the generic bot trigger');
    assert.ok(!body.includes('Additional context'), 'context noise is suppressed for releases');
  });

  it('notes internal-tooling files excluded from the line count', () => {
    const body = buildTierComment(2, makeSignals({
      internalToolingFiles: [makeFile('packages/hdx-eval/src/grade.ts', 400, 50)],
    }));
    assert.ok(body.includes('internal-tooling'));
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

  it('never singles out a branch for being agent-named', () => {
    const base = makeSignals({ branchName: 'feat/thing' });
    const agent = makeSignals({ branchName: 'claude/thing' });
    // Only the branch name itself should differ between the two bodies
    assert.equal(
      buildTierComment(2, agent).replace(/claude\/thing/g, 'feat/thing'),
      buildTierComment(2, base)
    );
  });

  it('does not call a workflow-only Tier 4 PR "docs / images / lock files"', () => {
    // main.yml is both trivial and infra-critical, so allFilesTrivial is true
    // while the PR escalates on pipeline churn. The two must not both render.
    const infraCriticalFiles = [makeFile('.github/workflows/main.yml', 30, 5)];
    const body = buildTierComment(4, makeSignals({
      criticalFiles: infraCriticalFiles,
      infraCriticalFiles,
      infraCriticalLines: 35,
      infraCriticalEscalates: true,
      allFilesTrivial: true,
      prodFiles: [],
      prodLines: 0,
    }));
    assert.ok(body.includes('delivery pipeline substantially modified'));
    assert.ok(!body.includes('All files are docs'), 'contradictory trigger must be suppressed');
    assert.ok(body.includes('Critical-path lines changed: 35'), 'stats must not report 0 churn');
  });

  it('does not throw on a fixture claiming a graze with no core-critical files', () => {
    assert.doesNotThrow(() => buildTierComment(2, makeSignals({ grazesCoreCritical: true })));
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

  it('explains line count trigger when prod lines exceed Tier 2 threshold', () => {
    const body = buildTierComment(3, makeSignals({ prodLines: 420 }));
    assert.ok(body.includes('420'));
    assert.ok(body.includes('Diff size'));
    assert.ok(!body.includes('Standard feature/fix'));
  });

  it('includes bot-author trigger for Tier 1 bot PRs', () => {
    const body = buildTierComment(1, makeSignals({ isBotAuthor: true, author: 'dependabot[bot]' }));
    assert.ok(body.includes('Bot author'));
  });
});
