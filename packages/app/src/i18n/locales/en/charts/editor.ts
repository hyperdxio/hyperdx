export const editor = {
  // RawSqlChartEditor
  connection: 'Connection',
  source: 'Source',
  sourceFilterHelp:
    'Optional. Required to apply dashboard filters to this chart.',
  sourceNone: 'None',
  addAlert: 'Add Alert',

  // PromqlChartEditor
  dataSource: 'Data Source',
  promqlExpression: 'PromQL Expression',

  // RawSqlChartInstructions
  instructionsTitle: 'SQL Chart Instructions',
  parametersHint:
    'The following parameters and macros can be used in this chart:',
  sourceTableDescription:
    'Resolves to selected source table (Source must be selected)',
  filtersDescription:
    'Applies the selected dashboard filter conditions to the chart (Source must be selected)',
  otherMacros:
    'Other available macros are described in the <docLink>ClickStack documentation.</docLink>',
  example: 'Example:',
} as const;

export const resultColumns = {
  plottedAs: 'Result columns are plotted as follows:',
  displayedAs: 'Result columns are displayed as follows:',

  // Timeseries (Line / StackedBar)
  timestampLabel: 'Timestamp',
  timestampDesc:
    '— The first <code>Date</code> or <code>DateTime</code> column.',
  seriesValueLabel: 'Series Value',
  seriesValueDesc:
    '— Each numeric column will be plotted as a separate series. These columns are generally aggregate function values.',
  groupNamesLabel: 'Group Names',
  groupNamesDesc:
    '(optional) — Any string, map, or array type result column will be treated as a group column. Result rows with different group column values will be plotted as separate series.',

  // Pie
  sliceValueLabel: 'Slice Value',
  sliceValueDesc: "— The first numeric column determines each slice's size.",
  sliceLabelLabel: 'Slice Label',
  sliceLabelDesc:
    '(optional) — Each unique value of each string, map, and array type columns will be used as a slice label.',

  // Bar
  barValueLabel: 'Bar Value',
  barValueDesc: "— The first numeric column determines each bar's height.",
  barLabelLabel: 'Bar Label',
  barLabelDesc:
    '(optional) — Each unique value of each string, map, and array type columns will be used as a bar label.',

  // Number
  numberLabel: 'Number',
  numberDesc:
    '— The value of the first numeric column in the first result row is displayed as the number.',
} as const;

export const validation = {
  connectionRequired: 'Connection is required',
  sqlRequired: 'SQL query is required',
  sourceRequired: 'Source is required',
  expressionRequired: 'Expression is required for series {{index}}',
  metricRequired: 'Metric is required',
  thresholdMaxRequired:
    'Upper bound is required for between/not between threshold types',
  thresholdMaxTooLow:
    'Alert threshold upper bound must be greater than or equal to the lower bound',
  singleSeries: 'Only one series is allowed for {{displayType}} charts',
  numberRatioSeries: 'Number charts support at most two series (ratio mode)',
  numberSingleSeries:
    'Number charts support a single series unless ratio mode (As Ratio) is enabled',
  heatmapValueExpression: 'Value expression is required for heatmap charts',
} as const;

export const metrics = {
  exponentialHistogramSuffix: '(Exponential Histogram)',
  groupBy: 'Group By',
  searchValues: 'Search values...',
  where: 'Where',
  noMatchingValues: 'No matching values found',
  noValues: 'No values found',
  searchAttributes: 'Search attributes...',
  unit: 'Unit:',
  attributeCount: '{{count}} attributes',
  noAttributes: 'No attributes found for this metric',
  loading: 'Loading...',
  loadError: 'Unable to load metrics',
  selectMetric: 'Select a metric...',
} as const;

export const propertyComparison = {
  emptyString: 'Empty String',
  tooltipError: 'An error occurred while rendering the tooltip.',
  selection: 'Selection',
  allSpans: 'All spans',
  background: 'Background:',
  filterForValue: 'Filter for this value',
  excludeValue: 'Exclude this value',
  copyValue: 'Copy value',
} as const;

export const seriesColor = {
  drawerTitle: 'Column Color',
  color: 'Color',
  description:
    'Applies to every cell in this column unless a rule below matches.',
  clear: 'Clear',
  apply: 'Apply',
  editColumnColor: 'Edit column color',
  columnColorAriaLabel: 'Column color',
} as const;

export const sqlConversion = {
  failedTitle: 'Could not auto-convert to SQL',
  convertedTitle: 'Chart converted to SQL',
  convertedMessage:
    'The existing chart configuration has been converted to SQL',
} as const;
