import { screen } from '@testing-library/react';

import { ChatMessageItem } from '@/llm/components/ChatMessageItem';

// click-ui encodes state only in hashed CSS module class names, so the mock
// exposes the props as attributes to assert on.
jest.mock('@clickhouse/click-ui', () => ({
  ...jest.requireActual('@clickhouse/click-ui'),
  Badge: ({
    text,
    state,
    'data-testid': testId,
  }: {
    text: React.ReactNode;
    state?: string;
    'data-testid'?: string;
  }) => (
    <span data-testid={testId} data-state={state}>
      {text}
    </span>
  ),
}));

describe('ChatMessageItem', () => {
  it.each([
    ['system', 'neutral'],
    ['developer', 'neutral'],
    ['user', 'info'],
    ['Assistant', 'success'],
    ['tool', 'warning'],
    ['function', 'warning'],
    ['other', 'neutral'],
  ])('renders the %s role with the %s state', (role, badgeState) => {
    renderWithMantine(
      <ChatMessageItem
        message={{ id: 0, source: 'input', role, content: null }}
      />,
    );

    const badge = screen.getByTestId('llm-chat-message-role');
    expect(badge).toHaveTextContent(role.toLowerCase());
    expect(badge).toHaveAttribute('data-state', badgeState);
  });
});
