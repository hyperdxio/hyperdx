import { ComponentProps } from 'react';

import { DBSearchPageFilters } from './DBSearchPageFilters';

// Props the sessions page controls. The analysis-mode toggles, delta view, and
// live-tail behavior don't apply to sessions, so they're baked in here instead
// of being threaded through the page.
type SessionFiltersProps = Omit<
  ComponentProps<typeof DBSearchPageFilters>,
  | 'analysisMode'
  | 'setAnalysisMode'
  | 'showDelta'
  | 'denoiseResults'
  | 'setDenoiseResults'
  | 'isLive'
  | 'hideAnalysisMode'
  | 'forceExactFacetMode'
>;

/**
 * Sessions-specific filter sidebar: the same faceted filters as the search
 * page, minus the "Analysis Mode" header/tabs and denoise toggle. A thin
 * wrapper over {@link DBSearchPageFilters} so the two stay in sync without
 * duplicating the facet machinery.
 *
 * `forceExactFacetMode` is on because the sessions `chartConfig` scopes facets
 * to RUM session spans; "all" mode would strip that scope and sample the whole
 * trace table, which times out and leaves the sidebar empty.
 */
export function SessionFilters(props: SessionFiltersProps) {
  return (
    <DBSearchPageFilters
      {...props}
      isLive={false}
      hideAnalysisMode
      forceExactFacetMode
    />
  );
}
