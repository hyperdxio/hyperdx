export const onboarding = {
  modal: {
    title: 'Welcome to {{brandName}}',
    connectionIntro: 'Lets set up your connection to ClickHouse',
    connectionHint: 'You can always add and edit connections later.',
    or: 'OR',
    demoServer: 'Connect to Demo Server',
    detecting: 'Detecting available tables...',
    skipToManual: 'Skip and setup manually',
    back: 'Back',
    autoDetected_one:
      'We automatically detected and created {{count}} source from your connection. You can review, edit, or continue.',
    autoDetected_other:
      'We automatically detected and created {{count}} sources from your connection. You can review, edit, or continue.',
    addMoreSources: 'Add more sources',
    continue: 'Continue',
    noTablesDetected:
      'No OTel tables detected automatically, please setup sources manually.',
    sourceIntro: 'Lets set up a source table to query telemetry from.',
    sourceHint: 'You can always add and edit sources later.',
    successTitle: 'Success',
    errorTitle: 'Error',
    autoDetectSuccess_one:
      'Automatically detected and created {{count}} source.',
    autoDetectSuccess_other:
      'Automatically detected and created {{count}} sources.',
    autoDetectError:
      'Failed to auto-detect telemetry sources. Please set up manually.',
    demoConnected: 'Connected to {{brandName}} demo server.',
    demoFailed:
      'Could not connect to the {{brandName}} demo server, please try again later.',
  },
  mcp: {
    hostLabel: 'MCP host',
    hostOther: 'Other',
    pasteInTerminal: 'Paste in your terminal:',
    addToCursor: 'Add to Cursor',
    cursorFallback: 'Or paste this JSON into Cursor settings > MCP:',
    addToVsCode: 'Add to VS Code',
    vscodeFallback: 'Or paste this JSON into .vscode/mcp.json:',
    vscodeNote:
      'Requires VS Code 1.99+ with the Copilot Chat MCP feature enabled.',
    openCodeConfig:
      'Paste this into `opencode.json` (project) or `~/.config/opencode/config.json` (global):',
    otherConfig: "Paste this into your host's MCP config:",
    deeplinkTooltip: 'Opens the host with the server pre-configured',
    hideManualSetup: 'Hide manual setup',
    manualSetup: 'Manual setup',
  },
  banner: {
    clickstackWarning:
      'This is not recommended for production use and is lacking core ClickStack features such as alerts and saved searches. For a proper experience, visit the <docs>ClickStack Docs</docs>',
  },
} as const;
