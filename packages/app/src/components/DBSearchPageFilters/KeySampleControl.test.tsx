import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { KeySampleControl } from './KeySampleControl';

describe('KeySampleControl', () => {
  it('shows how many parts the filters were sampled from', () => {
    renderWithMantine(
      <KeySampleControl
        sample={{ sampledParts: 3, totalParts: 48 }}
        ratio={0}
        onRatioChange={jest.fn()}
      />,
    );

    expect(screen.getByText('Sampled from 3 of 48 parts')).toBeInTheDocument();
  });

  it('asks for a larger sample', async () => {
    const onRatioChange = jest.fn();
    renderWithMantine(
      <KeySampleControl
        sample={{ sampledParts: 3, totalParts: 48 }}
        ratio={0}
        onRatioChange={onRatioChange}
      />,
    );

    await userEvent.click(screen.getByText('100%'));

    expect(onRatioChange).toHaveBeenCalledWith(1);
  });

  it('hides the control when the sample already reads every part', () => {
    renderWithMantine(
      <KeySampleControl
        sample={{ sampledParts: 1, totalParts: 1 }}
        ratio={0}
        onRatioChange={jest.fn()}
      />,
    );

    expect(screen.getByText('Read from all 1 part')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });
});
