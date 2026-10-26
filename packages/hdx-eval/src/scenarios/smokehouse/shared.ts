import type { Rubric } from '@/grading/types';

export const SMOKEHOUSE_PREFIX = 'sh-';

type SmokehouseRubricEntry =
  | [string, number, string]
  | [string, number, string, boolean]
  | [string, number, string, boolean, { section: string; pattern: string }];

export type SmokehouseGroundTruth = {
  scenario: string;
  expected: Record<string, unknown> & {
    originService: string;
    affectedService?: string;
    userFacingService?: string;
    summary: string;
    contributingFactors?: string[];
  };
  rubric: {
    programmatic: SmokehouseRubricEntry[];
    judge?: { criteria: Rubric['judge']['criteria'] };
  };
  mechanisms?: Record<string, string[]>;
  cause?: string[];
};

export function alertingService(gt: SmokehouseGroundTruth): string {
  const e = gt.expected;
  return e.userFacingService ?? e.affectedService ?? e.originService;
}
