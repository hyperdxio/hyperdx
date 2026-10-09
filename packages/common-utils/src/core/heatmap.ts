import type { PromqlHeatmapMode } from '@/types';

/** A heatmap's mode; tiles saved before modes existed are distribution heatmaps. */
export function getHeatmapMode<M extends PromqlHeatmapMode>(config: {
  heatmap?: { mode?: M };
}): M | 'distribution' {
  return config.heatmap?.mode ?? 'distribution';
}
