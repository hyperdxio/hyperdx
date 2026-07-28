export const actionBar = {
  orderBy: 'ORDER BY',
  saveToDashboard: 'Save to Dashboard',
} as const;

export const editorControls = {
  dataSource: 'Data Source',
  patternExprPlaceholder:
    'Default ({{expression}}) — column name or expression',
  patternExprPlaceholderDefault: 'Default — column name or expression',
  patternExpressionLabel: 'Pattern Expression',
  patternExpressionError:
    'Pattern expression must be a single column or expression — multi-column lists are not supported. The source default will be used instead.',
  groupBy: 'Group By',
  sqlColumnsPlaceholder: 'SQL Columns',
  having: 'Having',
  havingPlaceholder: 'SQL HAVING clause (ex. count() > 100)',
  addSeries: 'Add Series',
  asRatio: 'As Ratio',
  shareOfTotal: 'Share of total',
  addAlert: 'Add Alert',
  select: 'SELECT',
} as const;

export const previewPanel = {
  boundsQuery: '1. Bounds query — resolves min/max for bucket boundaries',
  heatmapQuery:
    '2. Heatmap query — runs after bounds resolve; <code>{{min}}</code>/<code>{{max}}</code> are filled in at runtime',
  emptyStateDescription:
    'Please start by defining your chart above and then click the play button to query data.',
  sampleMatchedEvents: 'Sample Matched Events',
  generatedSql: 'Generated SQL',
} as const;

export const seriesEditor = {
  alias: 'Alias',
  aliasPlaceholder: 'Series alias',
  moveUp: 'Move up',
  moveDown: 'Move down',
  duplicateSeries: 'Duplicate series',
  removeSeries: 'Remove Series',
  editDisplayFormat: 'Edit series display format',
  delta: 'Delta',
  sqlColumnPlaceholder: 'SQL Column',
  where: 'Where',
  groupBy: 'Group By',
  sqlColumnsPlaceholder: 'SQL Columns',
  having: 'Having',
  havingPlaceholder: 'SQL HAVING clause (ex. count() > 100)',
} as const;

export const form = {
  types: {
    line: 'Time Series',
    table: 'Table',
    number: 'Number',
    bar: 'Bar',
    pie: 'Pie',
    search: 'Search',
    heatmap: 'Heatmap',
    patterns: 'Patterns',
    markdown: 'Markdown',
  },
  invalidChart: 'Invalid Chart',
  chartName: 'Chart Name',
  chartNamePlaceholder: 'My Chart Name',
  configType: {
    builder: 'Builder',
    sql: 'SQL',
    promql: 'PromQL',
  },
  markdownContentLabel: 'Markdown content',
  markdownPlaceholder: 'Markdown',
} as const;

export const alertEditor = {
  alert: 'Alert',
  invalidQuery: 'Invalid Query',
  warning: 'Warning',
  removeAlert: 'Remove alert',
  triggerWhenValue: 'Trigger when the value',
  and: 'and',
  over: 'over',
  via: 'via',
  createdBy: 'Created by {{name}}',
  sendTo: 'Send to',
  floatingPointNote:
    'Note: Floating-point query results are not rounded during equality comparison.',
} as const;
