jest.mock('next-runtime-env', () => ({
  env: (key: string) =>
    key === 'NEXT_PUBLIC_INSTANCE_LABEL' ? '  prod-U😀  ' : undefined,
}));

import { INSTANCE_LABEL } from '@/config';

describe('INSTANCE_LABEL (emoji input)', () => {
  it('trims without mangling multi-byte characters', () => {
    expect(INSTANCE_LABEL).toBe('prod-U😀');
  });
});
