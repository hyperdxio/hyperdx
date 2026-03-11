global.console = {
  ...console,
  // Turn off noisy console logs in tests
  debug: jest.fn(),
  info: jest.fn(),
};
