import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import { getReviewCopy, rateOptimizationLevel } from '../performanceReview';
import { OptimizationPlugin, OptimizationSeverity } from '../types';
import { OptimizationResult } from '../useOptimizations';

function makeSource(id: string): TSource {
  return {
    id,
    name: id,
    kind: SourceKind.Log,
    connection: 'conn-1',
    from: { databaseName: 'db', tableName: id },
    timestampValueExpression: 'TimestampTime',
    defaultTableSelectExpression: 'Body',
  } as TSource;
}

function makePlugin(
  id: string,
  severity: OptimizationSeverity,
): OptimizationPlugin<{ sourceId: string }> {
  return {
    id,
    title: id,
    shortLabel: id,
    description: '',
    severity,
    detect: async () => [],
    renderFinding: () => null,
    resolveSource: (finding, sources) =>
      sources.find(s => s.id === finding.detail.sourceId),
  };
}

function makeResult(
  plugin: OptimizationPlugin<{ sourceId: string }>,
  activeForSourceIds: string[],
): OptimizationResult {
  const activeFindings = activeForSourceIds.map(sourceId => ({
    scopeId: `source:${sourceId}`,
    summary: '',
    detail: { sourceId },
  }));
  return {
    plugin,
    findings: activeFindings,
    activeFindings,
    dismissedFindings: [],
    isLoading: false,
  };
}

describe('rateOptimizationLevel', () => {
  it('grades Overachieving when no active findings exist', () => {
    const review = rateOptimizationLevel([makeSource('a')], []);
    expect(review.grade).toBe('Overachieving');
    expect(review.totalActive).toBe(0);
    expect(review.score).toBe(0);
  });

  it('grades Overachieving when only minor findings are present', () => {
    // 2 sources, 1 info finding on one of them → score = 1 / 2 = 0.5
    const sources = [makeSource('a'), makeSource('b')];
    const plugin = makePlugin('p1', 'info');
    const review = rateOptimizationLevel(sources, [makeResult(plugin, ['a'])]);
    expect(review.grade).toBe('Overachieving');
    expect(review.totalActive).toBe(1);
  });

  it('grades Satisfactory for one recommended finding per source', () => {
    // 2 sources, 1 recommended each → score = 4 / 2 = 2 → Satisfactory
    const sources = [makeSource('a'), makeSource('b')];
    const plugin = makePlugin('p1', 'recommended');
    const review = rateOptimizationLevel(sources, [
      makeResult(plugin, ['a', 'b']),
    ]);
    expect(review.grade).toBe('Satisfactory');
    expect(review.score).toBe(2);
  });

  it('grades Needs Improvement when severity-weighted average is high', () => {
    // 1 source with 1 critical → score = 4 → Needs Improvement
    const sources = [makeSource('a')];
    const plugin = makePlugin('p1', 'critical');
    const review = rateOptimizationLevel(sources, [makeResult(plugin, ['a'])]);
    expect(review.grade).toBe('Needs Improvement');
    expect(review.score).toBe(4);
  });

  it('factors severity weights into the score', () => {
    // 1 source: 1 info + 1 recommended + 1 critical = 7 → Needs Improvement
    const sources = [makeSource('a')];
    const review = rateOptimizationLevel(sources, [
      makeResult(makePlugin('info-p', 'info'), ['a']),
      makeResult(makePlugin('rec-p', 'recommended'), ['a']),
      makeResult(makePlugin('crit-p', 'critical'), ['a']),
    ]);
    expect(review.score).toBe(7);
    expect(review.grade).toBe('Needs Improvement');
    expect(review.totalActive).toBe(3);
  });

  it('averages over all sources, not just affected ones', () => {
    // 1 critical finding spread across 4 sources → 4 / 4 = 1 → Overachieving
    const sources = ['a', 'b', 'c', 'd'].map(makeSource);
    const review = rateOptimizationLevel(sources, [
      makeResult(makePlugin('crit', 'critical'), ['a']),
    ]);
    expect(review.score).toBe(1);
    expect(review.grade).toBe('Overachieving');
    expect(review.sourcesWithFindings).toBe(1);
    expect(review.sourceCount).toBe(4);
  });

  it('does not divide by zero when the team has no sources yet', () => {
    const review = rateOptimizationLevel([], []);
    expect(review.score).toBe(0);
    expect(review.grade).toBe('Overachieving');
  });

  it('counts findings without a resolved source against the team score', () => {
    // No source → finding contributes to the weighted total but lands in the
    // "general" bucket. Still pulls the team-wide score.
    const sources = [makeSource('a')];
    const plugin: OptimizationPlugin<unknown> = {
      id: 'general',
      title: 'general',
      shortLabel: 'general',
      description: '',
      severity: 'critical',
      detect: async () => [],
      renderFinding: () => null,
      resolveSource: () => undefined,
    };
    const review = rateOptimizationLevel(sources, [
      {
        plugin,
        findings: [{ scopeId: 'setting:x', summary: '', detail: {} }],
        activeFindings: [{ scopeId: 'setting:x', summary: '', detail: {} }],
        dismissedFindings: [],
        isLoading: false,
      },
    ]);
    expect(review.score).toBe(4);
    expect(review.grade).toBe('Needs Improvement');
  });
});

describe('getReviewCopy', () => {
  it('returns a green palette for Overachieving', () => {
    const copy = getReviewCopy({
      grade: 'Overachieving',
      score: 0,
      totalActive: 0,
      sourceCount: 1,
      sourcesWithFindings: 0,
    });
    expect(copy.color).toBe('green');
    expect(copy.title).toBeTruthy();
    expect(copy.body).toBeTruthy();
  });

  it('uses a different Overachieving message when totalActive > 0 vs 0', () => {
    const allClear = getReviewCopy({
      grade: 'Overachieving',
      score: 0,
      totalActive: 0,
      sourceCount: 1,
      sourcesWithFindings: 0,
    });
    const minorStuff = getReviewCopy({
      grade: 'Overachieving',
      score: 1,
      totalActive: 1,
      sourceCount: 1,
      sourcesWithFindings: 1,
    });
    expect(allClear.title).not.toBe(minorStuff.title);
  });

  it('returns a yellow palette for Satisfactory', () => {
    const copy = getReviewCopy({
      grade: 'Satisfactory',
      score: 2,
      totalActive: 2,
      sourceCount: 1,
      sourcesWithFindings: 1,
    });
    expect(copy.color).toBe('yellow');
  });

  it('returns a red palette for Needs Improvement', () => {
    const copy = getReviewCopy({
      grade: 'Needs Improvement',
      score: 5,
      totalActive: 5,
      sourceCount: 1,
      sourcesWithFindings: 1,
    });
    expect(copy.color).toBe('red');
  });
});
