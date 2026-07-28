import { common } from './common';
import {
  background,
  colorRules,
  colorSwatch,
  container,
  delta,
  displaySettings,
  errorState,
  seriesFormat,
  sqlPreview,
} from './display';
import {
  editor,
  metrics,
  propertyComparison,
  resultColumns,
  seriesColor,
  sqlConversion,
  validation,
} from './editor';
import { aggFn, granularity, page } from './exploration';
import {
  actionBar,
  alertEditor,
  editorControls,
  form,
  previewPanel,
  seriesEditor,
} from './form';
import { heatmap, histogram } from './heatmap';
import { numberFormat } from './numberFormat';
import { onClick } from './onClick';
import { barChart, tableChart, tableSelect, timeChart } from './seriesCharts';

export const charts = {
  actionBar,
  aggFn,
  alertEditor,
  background,
  barChart,
  colorRules,
  colorSwatch,
  common,
  container,
  delta,
  displaySettings,
  editor,
  editorControls,
  errorState,
  form,
  granularity,
  heatmap,
  histogram,
  metrics,
  numberFormat,
  onClick,
  page,
  previewPanel,
  propertyComparison,
  resultColumns,
  seriesColor,
  seriesEditor,
  seriesFormat,
  sqlConversion,
  sqlPreview,
  tableChart,
  tableSelect,
  timeChart,
  validation,
} as const;
