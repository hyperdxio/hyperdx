// Suppress noisy console.debug output (e.g. ClickHouse query logging)
// during test runs. Warnings and errors still appear.
jest.spyOn(console, 'debug').mockImplementation(() => {});
jest.spyOn(console, 'info').mockImplementation(() => {});
