import { render, screen } from '@testing-library/react';

jest.mock('@/config', () => ({ INSTANCE_LABEL: '' }));

import { InstanceLabel } from '@/components/AppNav/InstanceLabel';

describe('InstanceLabel (INSTANCE_LABEL unset)', () => {
  it('renders nothing by default', () => {
    const { container } = render(<InstanceLabel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the fallback instead, e.g. the sidebar UTC badge', () => {
    render(<InstanceLabel fallback={<span>UTC</span>} />);
    expect(screen.getByText('UTC')).toBeInTheDocument();
  });
});
