import { fullTextIndexPlugin } from './plugins/fullTextIndex';
import { primaryKeyPlugin } from './plugins/primaryKey';
import { OptimizationPlugin } from './types';

// Append new plugins here. Detection runs in parallel via TanStack Query and
// each plugin gets its own `useQuery` keyed on its `id`, so failures of one
// plugin don't suppress findings from another.
export const optimizationPlugins: OptimizationPlugin<any>[] = [
  fullTextIndexPlugin,
  primaryKeyPlugin,
];
