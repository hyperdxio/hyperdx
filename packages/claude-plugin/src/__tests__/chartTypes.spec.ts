import { expect, it } from '@jest/globals';

import type * as Published from '../../hooks/chart';
import * as Source from '../index';

// Fails to compile when hooks/chart.d.ts drifts from what src/index.ts exports.
const published: typeof Published = Source;

it('keeps the published chart types in step with the source', () => {
  expect(published).toBe(Source);
});
