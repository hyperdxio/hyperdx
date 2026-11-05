export type ChartCall = {
  tool: string;
  input: unknown;
  output: unknown;
  calledAt: number;
};

declare module 'claude-code' {
  interface PluginState {
    // Charted calls by tool_use_id: MCP rows don't carry their output to ui.render.
    'hyperdx-charts': { calls: Record<string, ChartCall> };
  }
}
