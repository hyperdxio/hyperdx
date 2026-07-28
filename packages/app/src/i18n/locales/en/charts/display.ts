export const displaySettings = {
  showCompleteIntervals: 'Show Complete Intervals',
  fillMissingIntervals: 'Fill Missing Intervals with Zero',
  compareToPreviousPeriod: 'Compare to Previous Period',
  fitYAxisToData: 'Fit Y-Axis to Data',
  fitYAxisToDataDescription:
    'Start the y-axis at the minimum of the displayed data instead of zero. Only applicable to line charts.',
  seriesLimit: 'Series Limit',
  seriesLimitDescription:
    'Maximum number of series fetched for a group-by chart. Leave empty to fetch every series.',
  seriesLimitPlaceholder: 'Disabled (e.g. {{example}})',
  categoricalLimitDescription:
    'Maximum number of values displayed, keeping those with the largest values. Leave empty to fetch all.',
  categoricalLimitPlaceholder: 'Disabled (e.g. 10)',
  displayGroupByColumnsOnLeft: 'Display Group By Columns on Left',
  color: 'Color',
  numberTileColorAriaLabel: 'Number tile color',
  formatOverridden: 'Format may be overridden on individual series.',
  resetToDefaults: 'Reset to Defaults',
} as const;

export const colorRules = {
  between: 'between',
  ruleLowerBound: 'Rule {{index}} lower bound',
  ruleUpperBound: 'Rule {{index}} upper bound',
  ruleValue: 'Rule {{index}} value',
  ruleOperator: 'Rule {{index}} operator',
  ruleColor: 'Rule {{index}} color',
  dragToReorder: 'Drag to reorder',
  deleteRule: 'Delete rule {{index}}',
  to: 'to',
  conditionalColors: 'Conditional colors',
  fallbackHint: 'Falls back to the tile color when no rule matches.',
  addRule: 'Add rule',
} as const;

export const colorSwatch = {
  categoricalColors: 'Categorical colors',
  categorical: 'Categorical',
  semanticColors: 'Semantic colors',
  semantic: 'Semantic',
  clear: 'Clear',
} as const;

export const seriesFormat = {
  title: 'Series Display Settings',
  inherit: 'Inherit',
  custom: 'Custom',
  inheritDescription: "Inherit display settings from chart's display settings.",
} as const;

export const background = {
  none: 'None',
  line: 'Line',
  area: 'Area',
  backgroundChart: 'Background chart',
  typeAriaLabel: 'Number tile background chart type',
  availableHint: 'Available on query-builder number tiles.',
  backgroundColor: 'Background color',
  colorAriaLabel: 'Number tile background chart color',
} as const;

export const sqlPreview = {
  loadingPreview: 'Loading query preview...',
  unableToFormat: 'Unable to format query.',
} as const;

export const delta = {
  selection: 'Selection',
  background: 'Background',
  allSpans: 'All spans',
  loading: 'Loading…',
  selectArea: 'Select an area on the chart above to enable comparisons',
  loadingAttributeDistributions: 'Loading attribute distributions…',
  lowerPriorityFields: 'Lower-priority fields ({{count}})',
} as const;

export const container = {
  tileActions: 'Tile actions',
} as const;

export const errorState = {
  errorLoading:
    'Error loading chart, please check your query or try again later.',
  seeErrorDetails: 'See Error Details',
  errorDetails: 'Error Details',
} as const;
