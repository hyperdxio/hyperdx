export const heatmap = {
  latency: 'Latency',
  colorScaleAriaLabel: 'Color scale: low to high count',
  low: 'Low',
  high: 'High',
  notEnoughData:
    'Not enough data points to render heatmap. Try expanding your search criteria.',
  dragToCompare: 'Drag to Compare · Click to Clear',
  yValue: 'Y Value:',
  countValue: 'Count Value:',
  scale: 'Scale',
  scaleLog: 'Log',
  scaleLinear: 'Linear',
  sqlExpressionPlaceholder: 'SQL expression',
  value: 'Value',
  count: 'Count',
} as const;

export const histogram = {
  bucket: 'Bucket:',
  numberOfEvents: 'Number of Events:',
  viewEvents: 'View Events',
  pinTooltipHint: 'Click to Pin Tooltip • Approx value via SPDT algorithm',
} as const;
