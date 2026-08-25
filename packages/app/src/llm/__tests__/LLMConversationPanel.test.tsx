import { screen } from '@testing-library/react';

import { makeTraceSource } from '@/llm/__fixtures__/sources';
import {
  SEMCONV_ATTRIBUTES_FIXTURE,
  VERCEL_AI_FIXTURE,
} from '@/llm/__fixtures__/spans';
import { LLMConversationPanel } from '@/llm/components/LLMConversationPanel';

// The panel fetches its own row via useRowData; the tests below control the
// returned row directly. Prefixed with `mock` so the hoisted jest.mock
// factory may reference it.
let mockRowData: Record<string, unknown> | undefined;
jest.mock('@/components/DBRowDataPanel', () => ({
  useRowData: () => ({
    data: mockRowData ? { data: [mockRowData] } : undefined,
    isLoading: false,
  }),
}));

const TRACE_SOURCE = makeTraceSource();

const renderPanel = () =>
  renderWithMantine(
    <LLMConversationPanel source={TRACE_SOURCE} rowId="Timestamp = 1" />,
  );

describe('LLMConversationPanel', () => {
  afterEach(() => {
    mockRowData = undefined;
  });

  it('renders normalized chat messages with roles and summary', () => {
    mockRowData = { __hdx_event_attributes: SEMCONV_ATTRIBUTES_FIXTURE };
    renderPanel();

    const messages = screen.getAllByTestId('llm-chat-message');
    expect(messages).toHaveLength(3);
    const roles = screen
      .getAllByTestId('llm-chat-message-role')
      .map(el => el.textContent);
    expect(roles).toEqual(['system', 'user', 'assistant']);
    expect(screen.getByText('What is HyperDX?')).toBeInTheDocument();
    expect(
      screen.getByText('HyperDX is an observability platform.'),
    ).toBeInTheDocument();
    // Summary header: model badge + usage.
    expect(screen.getByText('gpt-4o-2024-08-06')).toBeInTheDocument();
    expect(screen.getByTestId('llm-token-usage')).toBeInTheDocument();
    // Estimated cost from the bundled catalog (gpt-4o prices).
    expect(screen.getByTestId('llm-cost').textContent).toContain('~$');
  });

  it('renders tool calls from Vercel AI SDK spans', () => {
    mockRowData = { __hdx_event_attributes: VERCEL_AI_FIXTURE };
    renderPanel();

    expect(screen.getByTestId('llm-tool-call')).toBeInTheDocument();
    expect(screen.getByText('searchFlights')).toBeInTheDocument();
  });

  it('shows an empty state when the span has no captured messages', () => {
    mockRowData = {
      __hdx_event_attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': 'gpt-4o',
      },
    };
    renderPanel();

    expect(
      screen.getByText(/No LLM messages found on this span/),
    ).toBeInTheDocument();
    // The summary subpanel still renders from the marker attributes.
    expect(screen.getByTestId('llm-span-subpanel')).toBeInTheDocument();
  });
});
