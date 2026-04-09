import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';

import type {
  SourceResponse,
  SavedSearchResponse,
  ProxyClickhouseClient,
} from '@/api/client';
import type { TimeRange } from '@/utils/editor';

export interface EventViewerProps {
  clickhouseClient: ProxyClickhouseClient;
  metadata: Metadata;
  source: SourceResponse;
  sources: SourceResponse[];
  savedSearches: SavedSearchResponse[];
  onSavedSearchSelect: (search: SavedSearchResponse) => void;
  initialQuery?: string;
  follow?: boolean;
}

export interface EventRow {
  [key: string]: string | number;
}

export interface Column {
  header: string;
  /** Percentage width string, e.g. "20%" */
  width: string;
}

export interface FormattedRow {
  cells: string[];
  severityColor?: 'red' | 'yellow' | 'blue' | 'gray';
}

export interface SwitchItem {
  type: 'saved' | 'source';
  label: string;
  search?: SavedSearchResponse;
  source?: SourceResponse;
}

export const TAIL_INTERVAL_MS = 2000;
export const PAGE_SIZE = 200;
