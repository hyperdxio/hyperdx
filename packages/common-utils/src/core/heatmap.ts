import type { HeatmapMode } from '@/types';

/** A builder heatmap's mode; tiles saved before modes existed are distribution heatmaps. */
export function getHeatmapMode(config: {
  heatmap?: { mode?: HeatmapMode };
}): HeatmapMode {
  return config.heatmap?.mode ?? 'distribution';
}
