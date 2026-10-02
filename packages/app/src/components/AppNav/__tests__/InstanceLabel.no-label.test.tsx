import { render } from '@testing-library/react';

jest.mock('@/config', () => ({ INSTANCE_LABEL: '' }));

import { InstanceLabel } from '@/components/AppNav/InstanceLabel';

describe('InstanceLabel (INSTANCE_LABEL unset)', () => {
  it('renders nothing', () => {
    const { container } = render(<InstanceLabel />);
    expect(container).toBeEmptyDOMElement();
  });
});
