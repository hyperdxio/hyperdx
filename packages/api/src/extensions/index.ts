// Registers optional extensions with the API's extension points, such as alert
// evaluators (see tasks/checkAlerts/evaluators.ts). Extension points call this
// once, on first use, so it runs after every module has loaded. This build
// registers none.
export const registerExtensions = (): void => {};
