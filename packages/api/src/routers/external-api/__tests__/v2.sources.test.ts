import { mapGranularityToExternalFormat } from '../v2/sources';

describe('External API v2 Sources', () => {
  describe('mapGranularityToExternalFormat', () => {
    it.each`
      input         | expected
      ${'1 second'} | ${'1s'}
      ${'1 minute'} | ${'1m'}
      ${'1 hour'}   | ${'1h'}
      ${'1 day'}    | ${'1d'}
    `(
      'maps supported long-form granularity $input to $expected',
      ({ input, expected }) => {
        expect(mapGranularityToExternalFormat(input)).toBe(expected);
      },
    );

    it.each`
      input          | expected
      ${'invalid'}   | ${'invalid'}
      ${'1m'}        | ${'1m'}
      ${'2 minutes'} | ${'2 minutes'}
    `(
      'passes through unsupported or already-short granularity $input',
      ({ input, expected }) => {
        expect(mapGranularityToExternalFormat(input)).toBe(expected);
      },
    );
  });
});
