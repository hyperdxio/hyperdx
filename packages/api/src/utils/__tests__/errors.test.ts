import { Api500Error, BaseError, isOperationalError } from '../errors';

describe('Errors utils', () => {
  test('BaseError class', () => {
    const e = new BaseError('nvim', 500, true, 'is the best editor!!!');
    expect(e.name).toBe('nvim');
    expect(e.statusCode).toBe(500);
    expect(e.isOperational).toBeTruthy();
    expect(e.message).toBe('is the best editor!!!');
    expect(e.stack?.includes('nvim: is the best editor'));
  });

  test('isOperational', () => {
    expect(
      isOperationalError(
        new BaseError('nvim', 500, true, 'is the best editor!!!'),
      ),
    ).toBeTruthy();
    expect(isOperationalError(new Api500Error('BANG'))).toBeTruthy();
  });
});
