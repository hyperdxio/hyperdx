import { useRef } from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { useConfirm } from '@/useConfirm';
import { copyTextToClipboard } from '@/utils/clipboard';

import type { QueryConfigMode, QueryLanguage } from './QueryEditor';
import {
  looksLikeSql,
  type QueryEditorMode,
  setExploreWhereLanguage,
  tryConvertLuceneToSqlWhere,
  tryConvertSqlWhereToLucene,
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

  const mode: QueryEditorMode = queryMode === 'sql' ? 'raw' : language;

  const persistLanguage = (nextLanguage: QueryLanguage) => {
    setExploreWhereLanguage(sourceKind, nextLanguage);
    onLanguageChange(nextLanguage);
  };

  const snapshotLuceneIfNeeded = () => {
    if (mode === 'lucene') {
      luceneSnapshotRef.current = where;
    }
  };

  const switchToLucene = async () => {
    if (mode === 'lucene') {
      return;
    }

    const leavingRaw = mode === 'raw';
    const sourceText = leavingRaw ? sqlTemplate : where;
    if (!leavingRaw && !looksLikeSql(where)) {
      persistLanguage('lucene');
      onQueryModeChange?.('builder');
      return;
    }

    if (sourceText.trim()) {
      await copyTextToClipboard(sourceText);
    }

    const converted = leavingRaw ? null : tryConvertSqlWhereToLucene(where);
    const snapshot = luceneSnapshotRef.current;

    if (converted) {
      const ok = await confirm(
        'This SQL will be converted to a search query. Cancel to keep editing SQL. The original SQL is copied to the clipboard.',
        'Convert to search',
      );
      if (!ok) {
        return;
      }
      onWhereChange(converted);
      persistLanguage('lucene');
      onQueryModeChange?.('builder');
      return;
    }

    if (snapshot) {
      const ok = await confirm(
        leavingRaw
          ? 'Raw SQL cannot be shown as a search query. Restore the last search query? The current SQL is copied to the clipboard. Cancel to keep editing SQL.'
          : 'This SQL cannot be shown as a search query. Restore the last search query? The current SQL is copied to the clipboard. Cancel to keep editing SQL.',
        'Restore search query',
      );
      if (!ok) {
        return;
      }
      onWhereChange(snapshot);
      persistLanguage('lucene');
      onQueryModeChange?.('builder');
      return;
    }

    if (leavingRaw) {
      const ok = await confirm(
        'Raw SQL cannot be shown as a search query. Switch to SQL WHERE instead? The current SQL is copied to the clipboard. Cancel to keep editing raw SQL.',
        'Switch to SQL',
      );
      if (!ok) {
        return;
      }
      persistLanguage('sql');
      onQueryModeChange?.('builder');
      return;
    }

    const ok = await confirm(
      'This SQL cannot be shown as a search query. Switch to an empty search? The current SQL is copied to the clipboard. Cancel to keep editing SQL.',
      'Switch to search',
    );
    if (!ok) {
      return;
    }
    onWhereChange('');
    persistLanguage('lucene');
    onQueryModeChange?.('builder');
  };

  const switchToSql = async () => {
    snapshotLuceneIfNeeded();
    if (mode === 'lucene' && where.trim() && !looksLikeSql(where)) {
      const converted = tryConvertLuceneToSqlWhere(where);
      if (converted != null) {
        onWhereChange(converted);
      } else {
        const ok = await confirm(
          'This search query cannot be converted to a SQL WHERE clause. Switch to an empty SQL clause? Your search query will be restored if you switch back. Cancel to keep editing the search query.',
          'Switch to SQL',
        );
        if (!ok) {
          return;
        }
        onWhereChange('');
      }
    }
    persistLanguage('sql');
    onQueryModeChange?.('builder');
  };

  const switchToRaw = () => {
    snapshotLuceneIfNeeded();
    persistLanguage('sql');
    onQueryModeChange?.('sql');
  };

  const onModeChange = async (next: QueryEditorMode) => {
    if (next === mode) {
      return;
    }
    if (next === 'lucene') {
      await switchToLucene();
      return;
    }
    if (next === 'sql') {
      await switchToSql();
      return;
    }
    switchToRaw();
  };

  return { mode, onModeChange };
}
