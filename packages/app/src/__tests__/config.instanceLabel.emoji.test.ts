jest.mock('next-runtime-env', () => ({ env: () => '  prod-U😀  ' }));

import { INSTANCE_LABEL } from '@/config';

describe('INSTANCE_LABEL (emoji input)', () => {
  it('trims without mangling multi-byte characters', () => {
    expect(INSTANCE_LABEL).toBe('prod-U😀');
  });
});
