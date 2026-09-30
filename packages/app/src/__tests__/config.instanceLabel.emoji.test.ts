jest.mock('next-runtime-env', () => ({ env: () => 'prod-U😀' }));

import { INSTANCE_LABEL } from '@/config';

describe('INSTANCE_LABEL (emoji input)', () => {
  it('slices by code point instead of splitting a surrogate pair', () => {
    expect(INSTANCE_LABEL).toBe('prod-U😀');
  });
});
