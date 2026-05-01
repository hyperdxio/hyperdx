import { TSource } from '@hyperdx/common-utils/dist/types';

import { OptimizationSeverity } from './types';
import { OptimizationResult } from './useOptimizations';

export type PerformanceGrade =
  | 'Overachieving'
  | 'Satisfactory'
  | 'Needs Improvement';

export type PerformanceReview = {
  grade: PerformanceGrade;
  // Average severity-weighted score per source (lower is better).
  score: number;
  totalActive: number;
  sourceCount: number;
  sourcesWithFindings: number;
};

const SEVERITY_WEIGHTS: Record<OptimizationSeverity, number> = {
  info: 1,
  recommended: 2,
  critical: 4,
};

// Tuned so a single mid-severity finding per source lands you firmly in
// Satisfactory, and a single critical finding per source pushes the team
// into Needs Improvement.
const OVERACHIEVING_MAX = 1.5;
const SATISFACTORY_MAX = 3.5;

/**
 * Rate the team's overall schema-optimization posture across sources.
 *
 * Metric: weighted active-finding score, averaged across the team's source
 * count (so a team with many well-tuned sources isn't penalized for a single
 * problem source, and a team with one source can't hide behind low totals).
 * Severity weights: info=1, recommended=2, critical=4.
 *
 * Grades:
 *   - Overachieving: zero findings, or score ≤ 1.5 per source
 *   - Satisfactory: score ≤ 3.5 per source
 *   - Needs Improvement: score > 3.5 per source
 */
export function rateOptimizationLevel(
  sources: TSource[],
  results: OptimizationResult[],
): PerformanceReview {
  // Always divide by at least 1 to avoid NaN when a team has no sources yet.
  const sourceCount = Math.max(sources.length, 1);

  let totalWeighted = 0;
  let totalActive = 0;
  const perSourceScore = new Map<string, number>();

  for (const result of results) {
    const weight = SEVERITY_WEIGHTS[result.plugin.severity];
    for (const finding of result.activeFindings) {
      totalActive++;
      totalWeighted += weight;
      const source = result.plugin.resolveSource?.(finding, sources);
      const key = source?.id ?? '__general__';
      perSourceScore.set(key, (perSourceScore.get(key) ?? 0) + weight);
    }
  }

  const score = totalWeighted / sourceCount;

  let grade: PerformanceGrade;
  if (totalActive === 0 || score <= OVERACHIEVING_MAX) {
    grade = 'Overachieving';
  } else if (score <= SATISFACTORY_MAX) {
    grade = 'Satisfactory';
  } else {
    grade = 'Needs Improvement';
  }

  return {
    grade,
    score,
    totalActive,
    sourceCount,
    sourcesWithFindings: perSourceScore.size,
  };
}

export type ReviewCopy = {
  title: string;
  body: string;
  // Tailwind/Mantine color name for the grade chip and accent stripe.
  color: 'green' | 'yellow' | 'red';
};

/**
 * Satirical "manager giving a performance review" copy for each grade.
 * Kept separate from `rateOptimizationLevel` so the scoring function stays
 * pure and easy to test, and so the prose is easy to iterate on without
 * touching the math.
 */
export function getReviewCopy(review: PerformanceReview): ReviewCopy {
  switch (review.grade) {
    case 'Overachieving':
      if (review.totalActive === 0) {
        return {
          title: 'Stellar performance',
          body: "I came in here ready to give some hard feedback. Genuinely. And… I've got nothing. You've made the rest of the team look bad. Keep it up — but, you know, maybe leave a little something for the rest of us next quarter.",
          color: 'green',
        };
      }
      return {
        title: 'Exceeds expectations',
        body: "A couple of rough edges, but overall: impressive. I had your name circled in the meeting earlier — in a good way, this time. Don't let it go to your head. There's always room to grow.",
        color: 'green',
      };
    case 'Satisfactory':
      return {
        title: 'Meets expectations',
        body: "You're hitting the bar. Not clearing it, exactly — hitting it. I had higher hopes going into this review, but here we are. Let's see if we can put together a little growth plan for next cycle.",
        color: 'yellow',
      };
    case 'Needs Improvement':
      return {
        title: 'Needs improvement',
        body: "Look, we need to have a conversation. There is some real low-hanging fruit being left on the floor. I'm not angry, I'm disappointed — but mostly I'm concerned. Good news: there's nowhere to go but up. Let's loop back end of week.",
        color: 'red',
      };
  }
}
