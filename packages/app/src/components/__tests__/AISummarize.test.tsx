import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react';

import {
  default as AISummarizeButton,
  formatEventContent,
} from '../AISummarizeButton';
import {
  default as AISummarizePatternButton,
  formatPatternContent,
} from '../AISummarizePatternButton';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMutate = jest.fn();
jest.mock('@/hooks/ai', () => ({
  useAISummarize: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

let mockMeData: { aiAssistantEnabled: boolean } | null = null;
jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useMe: () => ({ data: mockMeData, isLoading: false }),
  },
}));

let mockEasterEggVisible = true;
jest.mock('../aiSummarize', () => {
  const actual = jest.requireActual('../aiSummarize');
  return {
    ...actual,
    isEasterEggVisible: () => mockEasterEggVisible,
  };
});

// ---------------------------------------------------------------------------
// Pure function tests — formatEventContent
// ---------------------------------------------------------------------------

describe('formatEventContent', () => {
  it('returns empty string for empty rowData', () => {
    expect(formatEventContent({})).toBe('');
  });

  it('includes severity when provided', () => {
    const result = formatEventContent({}, 'error');
    expect(result).toBe('Severity: error');
  });

  it('includes body string', () => {
    const result = formatEventContent({ __hdx_body: 'request failed' });
    expect(result).toContain('Body: request failed');
  });

  it('JSON-stringifies non-string body', () => {
    const result = formatEventContent({ __hdx_body: { key: 'val' } });
    expect(result).toContain('Body: {"key":"val"}');
  });

  it('includes service, span, status, duration', () => {
    const result = formatEventContent({
      ServiceName: 'api-svc',
      SpanName: 'GET /users',
      StatusCode: 'STATUS_CODE_ERROR',
      Duration: 5000000,
    });
    expect(result).toContain('Service: api-svc');
    expect(result).toContain('Span: GET /users');
    expect(result).toContain('Status: STATUS_CODE_ERROR');
    expect(result).toContain('Duration: 5000000ns');
  });

  it('includes event attributes (capped at 20)', () => {
    const attrs: Record<string, string> = {};
    for (let i = 0; i < 25; i++) {
      attrs[`key${i}`] = `val${i}`;
    }
    const result = formatEventContent({
      __hdx_event_attributes: attrs,
    });
    expect(result).toContain('Attributes:');
    expect(result).toContain('key0=val0');
    // Should be capped at 20
    expect(result).not.toContain('key20=val20');
  });

  it('includes resource attributes (capped at 10)', () => {
    const res: Record<string, string> = {};
    for (let i = 0; i < 15; i++) {
      res[`res${i}`] = `v${i}`;
    }
    const result = formatEventContent({
      __hdx_resource_attributes: res,
    });
    expect(result).toContain('Resource:');
    expect(result).toContain('res0=v0');
    expect(result).not.toContain('res10=v10');
  });

  it('includes exception info', () => {
    const result = formatEventContent({
      __hdx_events_exception_attributes: {
        'exception.type': 'NullPointerException',
        'exception.message': 'obj is null',
      },
    });
    expect(result).toContain('Exception: NullPointerException');
    expect(result).toContain('Exception message: obj is null');
  });

  it('skips empty/null attribute values', () => {
    const result = formatEventContent({
      __hdx_event_attributes: {
        filled: 'yes',
        empty: '',
        nul: null,
      },
    });
    expect(result).toContain('filled=yes');
    expect(result).not.toContain('empty=');
    expect(result).not.toContain('nul=');
  });
});

// ---------------------------------------------------------------------------
// Pure function tests — formatPatternContent
// ---------------------------------------------------------------------------

describe('formatPatternContent', () => {
  const makePattern = (
    overrides: Partial<{
      pattern: string;
      count: number;
      samples: Record<string, any>[];
    }> = {},
  ) => ({
    pattern: overrides.pattern ?? 'GET /api/<*>',
    count: overrides.count ?? 42,
    samples: overrides.samples ?? [],
  });

  it('includes pattern name and count', () => {
    const result = formatPatternContent(makePattern(), 'ServiceName');
    expect(result).toContain('Pattern: GET /api/<*>');
    expect(result).toContain('Occurrences: 42');
  });

  it('includes up to 5 samples', () => {
    const samples = Array.from({ length: 8 }, (_, i) => ({
      __hdx_pattern_field: `body ${i}`,
      ServiceName: `svc-${i}`,
      __hdx_severity_text: `info`,
    }));
    const result = formatPatternContent(
      makePattern({ samples }),
      'ServiceName',
    );
    expect(result).toContain('Sample events:');
    expect(result).toContain('body 0');
    expect(result).toContain('body 4');
    expect(result).not.toContain('body 5');
  });

  it('handles empty samples', () => {
    const result = formatPatternContent(
      makePattern({ samples: [] }),
      'ServiceName',
    );
    expect(result).not.toContain('Sample events:');
  });
});

// ---------------------------------------------------------------------------
// Component tests — AISummarizeButton
// ---------------------------------------------------------------------------

describe('AISummarizeButton', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockMutate.mockReset();
    mockMeData = null;
    mockEasterEggVisible = true;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing when AI disabled and easter egg not visible', () => {
    mockMeData = { aiAssistantEnabled: false };
    mockEasterEggVisible = false;
    renderWithMantine(<AISummarizeButton rowData={{}} />);
    expect(screen.queryByText('Summarize')).not.toBeInTheDocument();
  });

  it('renders Summarize button when easter egg is visible (no AI)', () => {
    mockMeData = { aiAssistantEnabled: false };
    mockEasterEggVisible = true;
    renderWithMantine(<AISummarizeButton rowData={{}} />);
    expect(screen.getByText('Summarize')).toBeInTheDocument();
  });

  it('renders Summarize button when AI is enabled (easter egg off)', () => {
    mockMeData = { aiAssistantEnabled: true };
    mockEasterEggVisible = false;
    renderWithMantine(<AISummarizeButton rowData={{}} />);
    expect(screen.getByText('Summarize')).toBeInTheDocument();
  });

  it('shows "Don\'t show" link that dismisses the button', () => {
    mockMeData = { aiAssistantEnabled: true };
    renderWithMantine(<AISummarizeButton rowData={{}} />);
    const dismissLink = screen.getByText("Don't show");
    expect(dismissLink).toBeInTheDocument();

    fireEvent.click(dismissLink);
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.queryByText('Summarize')).not.toBeInTheDocument();
  });

  it('uses fake AI (setTimeout) when AI is not enabled', () => {
    mockMeData = { aiAssistantEnabled: false };
    renderWithMantine(
      <AISummarizeButton
        rowData={{ __hdx_body: 'hello' }}
        severityText="info"
      />,
    );

    fireEvent.click(screen.getByText('Summarize'));
    expect(screen.getByText('Analyzing event data...')).toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByText('AI Summary')).toBeInTheDocument();
  });

  it('calls real AI mutate when AI is enabled', () => {
    mockMeData = { aiAssistantEnabled: true };
    renderWithMantine(
      <AISummarizeButton
        rowData={{ __hdx_body: 'error occurred' }}
        severityText="error"
      />,
    );

    fireEvent.click(screen.getByText('Summarize'));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledWith(
      {
        type: 'event',
        content: expect.stringContaining('Severity: error'),
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('displays AI summary after successful mutate', () => {
    mockMeData = { aiAssistantEnabled: true };
    renderWithMantine(<AISummarizeButton rowData={{ __hdx_body: 'test' }} />);

    fireEvent.click(screen.getByText('Summarize'));

    const call = mockMutate.mock.calls[0];
    act(() => {
      call[1].onSuccess({ summary: 'This event indicates a healthy request.' });
    });

    expect(
      screen.getByText('This event indicates a healthy request.'),
    ).toBeInTheDocument();
  });

  it('displays error message on mutate failure', () => {
    mockMeData = { aiAssistantEnabled: true };
    renderWithMantine(<AISummarizeButton rowData={{ __hdx_body: 'test' }} />);

    fireEvent.click(screen.getByText('Summarize'));

    const call = mockMutate.mock.calls[0];
    act(() => {
      call[1].onError(new Error('Provider timeout'));
    });

    expect(screen.getByText('Provider timeout')).toBeInTheDocument();
  });

  it('toggles panel open/closed after result exists', () => {
    mockMeData = { aiAssistantEnabled: true };
    renderWithMantine(<AISummarizeButton rowData={{ __hdx_body: 'test' }} />);

    fireEvent.click(screen.getByText('Summarize'));
    const call = mockMutate.mock.calls[0];
    act(() => {
      call[1].onSuccess({ summary: 'Summary text' });
    });

    expect(screen.getByText('Summary text')).toBeInTheDocument();

    // Click to hide
    fireEvent.click(screen.getByText('Hide Summary'));
    // The collapse will hide content, button label changes back
    expect(screen.getByText('Summarize')).toBeInTheDocument();
  });

  it('shows Regenerate button when result is visible', () => {
    mockMeData = { aiAssistantEnabled: true };
    renderWithMantine(<AISummarizeButton rowData={{ __hdx_body: 'test' }} />);

    fireEvent.click(screen.getByText('Summarize'));
    const call = mockMutate.mock.calls[0];
    act(() => {
      call[1].onSuccess({ summary: 'First summary' });
    });

    expect(screen.getByText('Regenerate')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Regenerate'));
    expect(mockMutate).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Component tests — AISummarizePatternButton
// ---------------------------------------------------------------------------

describe('AISummarizePatternButton', () => {
  const pattern = {
    pattern: 'GET /api/<*>',
    count: 100,
    samples: [
      {
        __hdx_pattern_field: 'GET /api/users',
        ServiceName: 'web',
        __hdx_severity_text: 'info',
      },
    ],
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockMutate.mockReset();
    mockMeData = null;
    mockEasterEggVisible = true;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing when AI disabled and easter egg not visible', () => {
    mockMeData = { aiAssistantEnabled: false };
    mockEasterEggVisible = false;
    renderWithMantine(
      <AISummarizePatternButton
        pattern={pattern}
        serviceNameExpression="ServiceName"
      />,
    );
    expect(screen.queryByText('Summarize')).not.toBeInTheDocument();
  });

  it('renders when AI is enabled regardless of easter egg', () => {
    mockMeData = { aiAssistantEnabled: true };
    mockEasterEggVisible = false;
    renderWithMantine(
      <AISummarizePatternButton
        pattern={pattern}
        serviceNameExpression="ServiceName"
      />,
    );
    expect(screen.getByText('Summarize')).toBeInTheDocument();
  });

  it('calls real AI with pattern type when AI enabled', () => {
    mockMeData = { aiAssistantEnabled: true };
    renderWithMantine(
      <AISummarizePatternButton
        pattern={pattern}
        serviceNameExpression="ServiceName"
      />,
    );

    fireEvent.click(screen.getByText('Summarize'));
    expect(mockMutate).toHaveBeenCalledWith(
      {
        type: 'pattern',
        content: expect.stringContaining('Pattern: GET /api/<*>'),
      },
      expect.any(Object),
    );
  });

  it('uses fake AI when AI is not enabled', () => {
    mockMeData = { aiAssistantEnabled: false };
    renderWithMantine(
      <AISummarizePatternButton
        pattern={pattern}
        serviceNameExpression="ServiceName"
      />,
    );

    fireEvent.click(screen.getByText('Summarize'));
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Analyzing pattern data...')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByText('AI Summary')).toBeInTheDocument();
  });

  it('shows "Don\'t show" link and dismisses', () => {
    mockMeData = { aiAssistantEnabled: true };
    renderWithMantine(
      <AISummarizePatternButton
        pattern={pattern}
        serviceNameExpression="ServiceName"
      />,
    );
    fireEvent.click(screen.getByText("Don't show"));
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.queryByText('Summarize')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Component tests — AISummaryPanel
// ---------------------------------------------------------------------------

// Direct import of the panel for isolated tests
import AISummaryPanelComponent from '../aiSummarize/AISummaryPanel';

describe('AISummaryPanel', () => {
  const AISummaryPanel = AISummaryPanelComponent;

  it('shows "Don\'t show" link when onDismiss is provided and panel is collapsed', () => {
    renderWithMantine(
      <AISummaryPanel
        isOpen={false}
        isGenerating={false}
        result={null}
        onToggle={jest.fn()}
        onRegenerate={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(screen.getByText("Don't show")).toBeInTheDocument();
  });

  it('hides "Don\'t show" link when panel is open', () => {
    renderWithMantine(
      <AISummaryPanel
        isOpen={true}
        isGenerating={false}
        result={{ text: 'test summary' }}
        onToggle={jest.fn()}
        onRegenerate={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(screen.queryByText("Don't show")).not.toBeInTheDocument();
  });

  it('does not show "Don\'t show" link when onDismiss is not provided', () => {
    renderWithMantine(
      <AISummaryPanel
        isOpen={false}
        isGenerating={false}
        result={null}
        onToggle={jest.fn()}
        onRegenerate={jest.fn()}
      />,
    );
    expect(screen.queryByText("Don't show")).not.toBeInTheDocument();
  });

  it('shows error text when error prop is set', () => {
    renderWithMantine(
      <AISummaryPanel
        isOpen={true}
        isGenerating={false}
        result={null}
        onToggle={jest.fn()}
        onRegenerate={jest.fn()}
        error="Something went wrong"
      />,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('shows theme label for Easter egg mode', () => {
    renderWithMantine(
      <AISummaryPanel
        isOpen={true}
        isGenerating={false}
        result={{ text: 'Summary', theme: 'noir' }}
        onToggle={jest.fn()}
        onRegenerate={jest.fn()}
        isRealAI={false}
      />,
    );
    expect(screen.getByText('Detective Noir')).toBeInTheDocument();
  });

  it('hides theme label for real AI mode', () => {
    renderWithMantine(
      <AISummaryPanel
        isOpen={true}
        isGenerating={false}
        result={{ text: 'Summary', theme: 'noir' }}
        onToggle={jest.fn()}
        onRegenerate={jest.fn()}
        isRealAI={true}
      />,
    );
    expect(screen.queryByText('Detective Noir')).not.toBeInTheDocument();
  });

  it('does not render info popover in real AI mode', () => {
    renderWithMantine(
      <AISummaryPanel
        isOpen={true}
        isGenerating={false}
        result={{ text: 'Summary' }}
        onToggle={jest.fn()}
        onRegenerate={jest.fn()}
        isRealAI={true}
      />,
    );
    expect(screen.queryByText('Happy April Fools!')).not.toBeInTheDocument();
  });

  it('uses non-italic text for real AI summaries', () => {
    renderWithMantine(
      <AISummaryPanel
        isOpen={true}
        isGenerating={false}
        result={{ text: 'Real AI result' }}
        onToggle={jest.fn()}
        onRegenerate={jest.fn()}
        isRealAI={true}
      />,
    );
    const el = screen.getByText('Real AI result');
    expect(el).not.toHaveStyle({ fontStyle: 'italic' });
  });
});
