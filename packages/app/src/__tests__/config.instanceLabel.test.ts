jest.mock('next-runtime-env', () => ({
  env: (key: string) =>
    key === 'NEXT_PUBLIC_INSTANCE_LABEL' ? '  ExtraLongLabel  ' : undefined,
}));

import { INSTANCE_LABEL } from '@/config';

describe('INSTANCE_LABEL', () => {
  it('trims whitespace without capping length', () => {
    expect(INSTANCE_LABEL).toBe('ExtraLongLabel');
  });
});
