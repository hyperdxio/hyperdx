import { MantineProvider } from '@mantine/core';
import { fireEvent, render } from '@testing-library/react';

import SQLInlineEditor from '@/components/SQLEditor/SQLInlineEditor';

jest.mock('@/hooks/useMetadata', () => ({
  useMultipleAllFields: jest.fn().mockReturnValue({ data: [] }),
}));
jest.mock('@/source', () => ({
  useSource: jest.fn().mockReturnValue({ data: undefined }),
}));

const noop = () => {};
const connection = { databaseName: 'db', tableName: 't', connectionId: 'c' };

const countCssRules = () =>
  [...document.styleSheets].reduce((n, s) => n + s.cssRules.length, 0);

describe('SQLInlineEditor', () => {
  it('submits with the latest onSubmit without reconfiguring the editor', () => {
    const first = jest.fn();
    const second = jest.fn();
    const editor = (onSubmit: () => void) => (
      <SQLInlineEditor
        tableConnection={connection}
        value="Timestamp"
        onChange={noop}
        onSubmit={onSubmit}
      />
    );
    const { container, rerender } = render(editor(first), {
      wrapper: MantineProvider,
    });
    const rulesAfterMount = countCssRules();

    rerender(editor(second));
    rerender(editor(first));
    rerender(editor(second));

    expect(countCssRules()).toBe(rulesAfterMount);

    const content = container.querySelector('.cm-content');
    if (content == null) throw new Error('editor did not mount');
    fireEvent.keyDown(content, { key: 'Enter', code: 'Enter', keyCode: 13 });

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
