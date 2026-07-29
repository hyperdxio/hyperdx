import { FieldPath, useController, UseControllerProps } from 'react-hook-form';
import { TableConnectionChoice } from '@hyperdx/common-utils/dist/core/metadata';
import {
  ActionIcon,
  Box,
  Flex,
  SegmentedControl,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconArrowsDiagonal,
  IconArrowsDiagonalMinimize2,
  IconHelp,
} from '@tabler/icons-react';

import SearchInputV2 from '@/components/SearchInput/SearchInputV2';
import { getStoredLanguage } from '@/components/SearchInput/SearchWhereInput';
import SyntaxReferenceModal from '@/components/SearchInput/SyntaxReferenceModal';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';

import styles from './ExploreQueryEditor.module.scss';

const STORAGE_KEY = 'hdx-search-where-language';

function setStoredLanguage(lang: 'sql' | 'lucene'): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, lang);
    }
  } catch {
    // localStorage may throw in private browsing
  }
}

export type ExploreQueryEditorProps = {
  onSubmit?: () => void;
  enableHotkey?: boolean;
  size?: 'xs' | 'sm';
  dateRange?: [Date, Date];
  sourceId?: string;
  sqlQueryHistoryType?: string;
  luceneQueryHistoryType?: string;
  sqlPlaceholder?: string;
  lucenePlaceholder?: string;
  additionalSuggestions?: string[];
  /** Form field name for the language value; defaults to `${name}Language`. */
  languageName?: string;
  /** Whether the editor body is expanded (multiline). */
  isExpanded: boolean;
  onToggleExpand: () => void;
  /** Right-aligned header controls (time picker, Live, Run, ...). */
  controls?: React.ReactNode;
  'data-testid'?: string;
} & TableConnectionChoice &
  UseControllerProps<any>;

/**
 * Explore-only query editor card. Owns the visual chrome (bordered card with a
 * header holding the Lucene/SQL language tabs on the left and caller-provided
 * controls plus an expand toggle on the right) while reusing the existing
 * SQL (CodeMirror) and Lucene (autocomplete) editors for the body. Kept
 * separate from the shared SearchWhereInput so the Explore layout can evolve
 * without affecting the Search page.
 */
export function ExploreQueryEditor({
  tableConnection,
  tableConnections,
  control,
  name,
  onSubmit,
  enableHotkey,
  size = 'xs',
  dateRange,
  sourceId,
  sqlQueryHistoryType,
  luceneQueryHistoryType,
  sqlPlaceholder = "SQL WHERE clause (ex. column = 'foo')",
  lucenePlaceholder = 'Search your events w/ Lucene ex. column:foo',
  additionalSuggestions,
  languageName = `${name}Language`,
  isExpanded,
  onToggleExpand,
  controls,
  'data-testid': dataTestId,
}: ExploreQueryEditorProps) {
  const [syntaxRefOpened, { open: openSyntaxRef, close: closeSyntaxRef }] =
    useDisclosure(false);

  const { field: languageField } = useController({
    control,
    name: languageName as FieldPath<any>,
  });

  const language: 'sql' | 'lucene' =
    languageField.value ?? getStoredLanguage() ?? 'sql';
  const isSql = language === 'sql';

  const handleLanguageChange = (lang: 'sql' | 'lucene') => {
    setStoredLanguage(lang);
    languageField.onChange(lang);
  };

  const tc = tableConnection ? { tableConnection } : { tableConnections };

  return (
    <>
      <SyntaxReferenceModal
        opened={syntaxRefOpened}
        onClose={closeSyntaxRef}
        language={language}
      />
      <Box
        className={styles.card}
        data-expanded={isExpanded ? 'true' : undefined}
        data-testid="explore-query-editor"
      >
        <Flex align="center" gap="sm" className={styles.header}>
          <SegmentedControl
            size="xs"
            value={language}
            onChange={value => handleLanguageChange(value as 'sql' | 'lucene')}
            data={[
              { label: 'SQL', value: 'sql' },
              { label: 'Lucene', value: 'lucene' },
            ]}
            aria-label="Query language"
          />
          <Tooltip label="Syntax reference" withArrow position="top">
            <ActionIcon
              variant="subtle"
              size="sm"
              color="gray"
              aria-label="Open syntax reference"
              onClick={openSyntaxRef}
            >
              <IconHelp size={16} />
            </ActionIcon>
          </Tooltip>
          <Flex
            align="center"
            gap="sm"
            ml="auto"
            wrap="nowrap"
            className={styles.controls}
          >
            {controls}
            <Tooltip
              label={isExpanded ? 'Collapse editor' : 'Expand editor'}
              position="bottom"
            >
              <ActionIcon
                variant="subtle"
                size="input-xs"
                color="gray"
                onClick={onToggleExpand}
                aria-label={isExpanded ? 'Collapse editor' : 'Expand editor'}
                data-testid="query-expand-toggle"
                style={{ flexShrink: 0 }}
              >
                {isExpanded ? (
                  <IconArrowsDiagonalMinimize2 size={16} />
                ) : (
                  <IconArrowsDiagonal size={16} />
                )}
              </ActionIcon>
            </Tooltip>
          </Flex>
        </Flex>
        <Box className={styles.body}>
          {isSql ? (
            <SQLInlineEditorControlled
              {...tc}
              control={control}
              name={name}
              placeholder={sqlPlaceholder}
              onSubmit={onSubmit}
              queryHistoryType={sqlQueryHistoryType}
              enableHotkey={enableHotkey}
              allowMultiline={isExpanded}
              showLineNumbers
              size={size}
              additionalSuggestions={additionalSuggestions}
              dateRange={dateRange}
              sourceId={sourceId}
            />
          ) : (
            <SearchInputV2
              {...tc}
              control={control}
              name={name}
              onSubmit={onSubmit}
              placeholder={lucenePlaceholder}
              queryHistoryType={luceneQueryHistoryType}
              enableHotkey={enableHotkey}
              size={size}
              data-testid={dataTestId}
              additionalSuggestions={additionalSuggestions}
              dateRange={dateRange}
              sourceId={sourceId}
            />
          )}
        </Box>
      </Box>
    </>
  );
}
