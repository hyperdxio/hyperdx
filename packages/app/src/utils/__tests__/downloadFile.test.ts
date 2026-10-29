import { downloadTextFile } from '@/utils/downloadFile';

describe('downloadTextFile', () => {
  it('creates an object URL, clicks a download anchor, and revokes the URL', () => {
    const createObjectURL = jest.fn((_blob: Blob) => 'blob:fake');
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    downloadTextFile('import {}', 'hyperdx-import.tf');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0][0].type).toBe('text/plain');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');

    click.mockRestore();
  });

  it('removes the anchor from the document after clicking', () => {
    Object.assign(URL, {
      createObjectURL: jest.fn(() => 'blob:fake'),
      revokeObjectURL: jest.fn(),
    });
    jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    downloadTextFile('import {}', 'hyperdx-import.tf');

    expect(document.querySelectorAll('a')).toHaveLength(0);
  });
});
