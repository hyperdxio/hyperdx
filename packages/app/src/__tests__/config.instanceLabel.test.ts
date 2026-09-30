jest.mock('next-runtime-env', () => ({ env: () => '  ExtraLongLabel  ' }));

import { INSTANCE_LABEL } from '@/config';

describe('INSTANCE_LABEL', () => {
  it('trims whitespace and caps at 7 characters', () => {
    expect(INSTANCE_LABEL).toBe('ExtraLo');
  });
});
