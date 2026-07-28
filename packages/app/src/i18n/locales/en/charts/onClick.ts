export const onClick = {
  filters: 'Filters',
  filtersHelp:
    'Enter an expression (e.g. a column name) and a template for its value.',
  expressionPlaceholder: 'Expression',
  removeFilter: 'Remove filter',
  addFilter: 'Add filter',
  where: 'WHERE',
  searchWhereTooltip:
    'Handlebars template that determines the WHERE condition passed to the search page',
  dashboardWhereTooltip:
    'Handlebars template that determines the global WHERE condition passed to the dashboard',
  externalUrlTooltip:
    'Handlebars template that resolves to an external URL. It is opened in a new tab when a row is clicked.',
  url: 'URL',
  externalUrlNote: 'The rendered value must be an absolute http(s) URL.',
  externalCaution:
    '<b>Caution:</b> this may navigate to an external site and include information from your data. Make sure the template does not contain any sensitive information, and that the external site is trusted.',
  rowClickTitle: 'Row Click Action',
  configureHelp: 'Configure the action taken when clicking on a table row.',
  modeDefault: 'Default',
  modeSearch: 'Search',
  modeDashboard: 'Dashboard',
  modeExternal: 'External',
  invalidTemplate: 'Invalid template',
  unknownError: 'Unknown error',
  linkError: 'Link error',
  defaultDescription:
    "Clicking a row opens the search page, filtered by the row's group-by column values and selected time range.",
  rowClickAction: 'Row Click Action:',
  template: 'Template',
} as const;
