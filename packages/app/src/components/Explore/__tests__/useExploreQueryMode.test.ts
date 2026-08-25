import { act, renderHook } from '@testing-library/react';

import { useExploreQueryMode } from '@/components/Explore/useExploreQueryMode';
import { useConfirm } from '@/useConfirm';
import { copyTextToClipboard } from '@/utils/clipboard';

jest.mock('@/useConfirm', () => ({ useConfirm: jest.fn() }));
jest.mock('@/utils/clipboard', () => ({
  copyTextToClipboard: jest.fn(() => Promise.resolve(true)),
}));

const mockUseConfirm = jest.mocked(useConfirm);
const mockCopy = jest.mocked(copyTextToClipboard);

type ModeProps = Parameters<typeof useExploreQueryMode>[0];

describe('useExploreQueryMode', () => {
  const onLanguageChange = jest.fn();
  const onWhereChange = jest.fn();
  const onQueryModeChange = jest.fn();
  const confirm = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseConfirm.mockReturnValue(confirm);
    confirm.mockResolvedValue(true);
  });

  function props(overrides: Partial<ModeProps> = {}): ModeProps {
    return {
      language: 'lucene',
      where: 'level:error',
      sqlTemplate: '',
      queryMode: 'builder',
      onLanguageChange,
      onWhereChange,
      onQueryModeChange,
      ...overrides,
    };
  }

  function renderMode(overrides: Partial<ModeProps> = {}) {
    return renderHook((p: ModeProps) => useExploreQueryMode(p), {
      initialProps: props(overrides),
    });
  }

  it('treats builder as Search and sql config as Raw SQL', () => {
    const search = renderMode();
    expect(search.result.current.mode).toBe('lucene');

    const raw = renderMode({ queryMode: 'sql' });
    expect(raw.result.current.mode).toBe('raw');
  });

  it('does not expose SQL WHERE when switching away from Search', async () => {
    const { result } = renderMode();
    await act(async () => {
      await result.current.onModeChange('raw');
    });
    expect(onQueryModeChange).toHaveBeenCalledWith('sql');
    expect(onLanguageChange).not.toHaveBeenCalled();
  });

  it('restores the last search query when leaving Raw SQL', async () => {
    const { result, rerender } = renderMode();

    await act(async () => {
      await result.current.onModeChange('raw');
    });

    rerender(props({ sqlTemplate: 'SELECT 1', queryMode: 'sql' }));

    await act(async () => {
      await result.current.onModeChange('lucene');
    });

    expect(mockCopy).toHaveBeenCalledWith('SELECT 1');
    expect(onWhereChange).toHaveBeenCalledWith('level:error');
    expect(onQueryModeChange).toHaveBeenCalledWith('builder');
    expect(onLanguageChange).not.toHaveBeenCalled();
  });

  it('stays on Raw SQL when the restore is cancelled', async () => {
    confirm.mockResolvedValue(false);
    const { result, rerender } = renderMode();

    await act(async () => {
      await result.current.onModeChange('raw');
    });
    rerender(props({ sqlTemplate: 'SELECT 1', queryMode: 'sql' }));
    await act(async () => {
      await result.current.onModeChange('lucene');
    });

    expect(onQueryModeChange).toHaveBeenCalledTimes(1);
    expect(onQueryModeChange).toHaveBeenCalledWith('sql');
    expect(onWhereChange).not.toHaveBeenCalled();
  });
});
