export const timeChart = {
  loadingData: 'Loading Chart Data...',
  noData: 'No data found within time range.',
  vsPrevious: ' (vs ',
  tooltipError: 'An error occurred while rendering the tooltip.',
  legendShowAll: 'Click to show all (Shift+click to deselect)',
  legendShowOnly: 'Click to show only this (Shift+click for multi-select)',
  more: '+{{count}} more',
  resetZoomTooltip: 'Reset to the range before zooming in',
  resetZoom: 'Reset zoom',
  eventLabel: 'Event',
  searchNewTab: 'Search (Opens in New Tab)',
  copyLabel: 'Copy Label',
  focus: 'Focus',
  viewAllEvents: 'View All Events',
  filterByGroup: 'Filter by group:',
  displayAsLine: 'Display as Line Chart',
  barChartUnavailable:
    'Bar Chart Unavailable When Comparing to Previous Period',
  displayAsBar: 'Display as Bar Chart',
} as const;

export const tableChart = {
  alternateRowBackground: 'Alternate Row Background',
  downloadCsv: 'Download table as CSV',
  showingFirst: 'Showing the first {{count}} rows.',
} as const;

export const barChart = {} as const;

export const tableSelect = {
  placeholder: 'Table',
} as const;
