/** Layout and measurement constants shared across the chart's parts. */
export const MAX_LEGEND_ITEMS = 4;

// Vertical pixel distance within which a series' line counts as "near" the
// cursor for tooltip highlighting. Beyond this, no row is emphasized so the
// tooltip is not misleading when the pointer is in empty space.
export const NEAREST_SERIES_MAX_DISTANCE_PX = 30;

// Gap below the data point for the hover tooltip. Kept equal to the pinned
// tooltip's Popover `offset` so both land in the same spot.
export const TOOLTIP_POINT_OFFSET_PX = 12;

export const Y_AXIS_WIDTH = 40;
export const SINGLE_POINT_BAR_RIGHT_PADDING = 10;
export const SINGLE_POINT_BAR_WIDTH_RATIO = 0.8;
// Top margin (px) reserved above the plot for annotation labels ("Alert"/"OK"),
// added only when a chart is showing annotations so other charts keep their
// tighter default headroom.
export const ANNOTATION_LABEL_HEADROOM = 18;
