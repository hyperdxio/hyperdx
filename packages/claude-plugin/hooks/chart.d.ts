// Types for the bundled hooks/chart.js. The published package ships without src/,
// so these are written out; src/__tests__/chartTypes.spec.ts keeps them in step.
import type { ChartCall } from '../types';

export type Segment = {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
};

export function chartedTool(toolName: string): string | undefined;
export function renderChart(
  call: ChartCall,
  columns: number,
): Segment[][] | undefined;
export function stripControlChars(text: string): string;
