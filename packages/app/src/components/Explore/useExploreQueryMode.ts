import { useRef } from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { useConfirm } from '@/useConfirm';
import { copyTextToClipboard } from '@/utils/clipboard';

import type { QueryConfigMode, QueryLanguage } from './QueryEditor';
import {
  type QueryEditorMode,
  setExploreWhereLanguage,
} from './queryModeSafety';

export function useExploreQueryMode({
  language,
  where,
  sqlTemplate,
  queryMode,
  sourceKind,
  onLanguageChange,
  onWhereChange,
  onQueryModeChange,
}: {
  language: QueryLanguage;
  where: string;
  sqlTemplate: string;
  queryMode?: QueryConfigMode;
  sourceKind?: SourceKind;
  onLanguageChange: (language: QueryLanguage) => void;
  onWhereChange: (where: string) => void;
  onQueryModeChange?: (mode: QueryConfigMode) => void;
}): {
  mode: QueryEditorMode;
  onModeChange: (next: QueryEditorMode) => Promise<void>;
} {
  const confirm = useConfirm();
  const luceneSnapshotRef = useRef('');

  const mode: QueryEditorMode = queryMode === 'sql' ? 'raw' : 'lucene';

  const persistSearchLanguage = () => {
    setExploreWhereLanguage(sourceKind, 'lucene');
    if (language !== 'lucene') {
      onLanguageChange('lucene');
    }
  };

  const snapshotSearchIfNeeded = () => {
    if (mode === 'lucene') {
      luceneSnapshotRef.current = where;
    }
  };

  const switchToSearch = async () => {
    if (mode === 'lucene') {
      return;
    }

    if (sqlTemplate.trim()) {
      await copyTextToClipboard(sqlTemplate);
    }

    const snapshot = luceneSnapshotRef.current;
    if (snapshot) {
      const ok = await confirm(
        'Raw SQL cannot be shown as a search query. Restore the last search query? The current SQL is copied to the clipboard. Cancel to keep editing raw SQL.',
        'Restore search query',
      );
      if (!ok) {
        return;
      }
      onWhereChange(snapshot);
    } else if (sqlTemplate.trim()) {
      const ok = await confirm(
        'Raw SQL cannot be shown as a search query. Switch to an empty search? The current SQL is copied to the clipboard. Cancel to keep editing raw SQL.',
        'Switch to search',
      );
      if (!ok) {
        return;
      }
      onWhereChange('');
    }

    persistSearchLanguage();
    onQueryModeChange?.('builder');
  };

  const switchToRaw = () => {
    snapshotSearchIfNeeded();
    onQueryModeChange?.('sql');
  };

  const onModeChange = async (next: QueryEditorMode) => {
    if (next === mode) {
      return;
    }
    if (next === 'lucene') {
      await switchToSearch();
      return;
    }
    switchToRaw();
  };

  return { mode, onModeChange };
}
