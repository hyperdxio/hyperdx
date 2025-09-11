import { isValidSlackUrl, isValidUrl } from '../validation';

describe('validation', () => {
  it.each([
    ['https://slack.com', true],
    ['https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXX', true],
    ['https://google.com', false],
    ['google.com', false],
    ['12312be127eb192ub', false],
  ])('isValidSlackUrl(%s) = %s', (url, expected) => {
    expect(isValidSlackUrl(url)).toBe(expected);
  });

  it.each([
    ['https://slack.com', true],
    ['https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXX', true],
    ['https://google.com', true],
    ['google.com', false],
    ['12312be127eb192ub', false],
  ])('isValidUrl(%s) = %s', (url, expected) => {
    expect(isValidUrl(url)).toBe(expected);
  });
});
