jest.mock('next-runtime-env', () => ({ env: () => '  ExtraLongLabel  ' }));

import { INSTANCE_LABEL } from '@/config';

describe('INSTANCE_LABEL', () => {
  it('trims whitespace without capping length', () => {
    expect(INSTANCE_LABEL).toBe('ExtraLongLabel');
  });
});
