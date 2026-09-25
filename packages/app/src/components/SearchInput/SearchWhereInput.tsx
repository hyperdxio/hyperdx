import { FieldPath, useController, UseControllerProps } from 'react-hook-form';
import { TableConnectionChoice } from '@hyperdx/common-utils/dist/core/metadata';
import { ActionIcon, Box, Flex, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconHelp } from '@tabler/icons-react';

import { EDITOR_INPUT_HEIGHTS } from '@/components/editorInputHeights';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';

import InputLanguageSwitch from './InputLanguageSwitch';
import SearchInputV2 from './SearchInputV2';
import SyntaxReferenceModal from './SyntaxReferenceModal';

import styles from './SearchWhereInput.module.scss';

const STORAGE_KEY = 'hdx-search-where-language';

/**
 * Returns the user's stored WHERE language preference, or null if none or unavailable.
 * Use when building form/URL defaults so the same selection applies across pages and on navigation.
 */
export function getStoredLanguage(): 'sql' | 'lucene' | null {
  try {
    const stored =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(STORAGE_KEY)
        : null;
    if (stored === 'sql' || stored === 'lucene') return stored;
  } catch {
    // localStorage may throw in private browsing
  }
  return null;
}

function setStoredLanguage(lang: 'sql' | 'lucene'): void {
  try {
    if (typeof window !== 'undefined')
      window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // localStorage may throw in private browsing
  }
}

export type SearchWhereInputProps = {
  /**
   * Callback when form should be submitted
   */
  onSubmit?: () => void;
  /**
   * Callback when language changes - typically used to update form state
   * If not provided, language switching will be handled internally
   */
  onLanguageChange?: (lang: 'sql' | 'lucene') => void;
  /**
   * Enable keyboard shortcut (/ or s) to focus the input
   */
  enableHotkey?: boolean;
  /**
   * Size of the input
   */
  size?: 'xs' | 'sm';
  /**
   * Enable multiline for SQL input
   */
  allowMultiline?: boolean;
  /**
   * Query history type for SQL input
   */
  sqlQueryHistoryType?: string;
  /**
   * Query history type for Lucene input
   */
  luceneQueryHistoryType?: string;
  /**
   * Placeholder for SQL input
   */
  sqlPlaceholder?: string;
  /**
   * Placeholder for Lucene input
   */
  lucenePlaceholder?: string;
  /**
   * Width style for the wrapper Box
   */
  width?: string | number;
  /**
   * Max width style for the wrapper Box
   */
  maxWidth?: string | number;
  /**
   * Min width style for the wrapper Box (useful in wrapping flex containers)
   */
  minWidth?: string | number;
  /**
   * Test ID for the input
   */
  'data-testid'?: string;
  /**
   * Additional autocomplete/suggestion options (e.g. attribute names)
   */
  additionalSuggestions?: string[];
  /**
   * Date range for filter or autocomplete queries
   */
  dateRange?: [Date, Date];
  /**
   * Form field name for the language value ('sql' | 'lucene').
   * If not provided, defaults to `${name}Language` (e.g. name="where" → "whereLanguage").
   */
  languageName?: string;
  /**
   * Source id used in various queries
   */
  sourceId?: string;
  parentRef?: HTMLElement | null;
  /** Whether the dashboard variables in scope apply to this expression. */
  enableVariables?: boolean;
} & TableConnectionChoice &
  UseControllerProps<any>;

/**
 * A unified search input component that handles both SQL and Lucene modes.
 *
 * This component expects two form fields:
 * - `name` (e.g., "where") - The actual search query value
 * - The language field - controlled by `languageName` (defaults to `${name}Language`, e.g. "whereLanguage")
 *
 * @example
 * ```tsx
 * <SearchWhereInput
 *   tableConnection={tcFromSource(source)}
 *   control={control}
 *   name="where"
 *   languageName="whereLanguage"
 *   onSubmit={handleSubmit}
 *   onLanguageChange={lang => setValue('whereLanguage', lang, { shouldDirty: true })}
 *   enableHotkey
 * />
 * ```
 */
export default function SearchWhereInput({
  tableConnection,
  tableConnections,
  control,
  name,
  onSubmit,
  onLanguageChange,
  enableHotkey,
  size = 'sm',
  allowMultiline = true,
  sqlQueryHistoryType,
  luceneQueryHistoryType,
  sqlPlaceholder = "SQL WHERE clause (ex. column = 'foo')",
  lucenePlaceholder = 'Search your events w/ Lucene ex. column:foo',
  width = '100%',
  maxWidth = '100%',
  minWidth,
  'data-testid': dataTestId,
  additionalSuggestions,
  dateRange,
  languageName = `${name}Language`,
  sourceId,
  parentRef,
  enableVariables = false,
}: SearchWhereInputProps) {
  const [syntaxRefOpened, { open: openSyntaxRef, close: closeSyntaxRef }] =
    useDisclosure(false);

  const { field: languageField } = useController({
    control,
    name: languageName as FieldPath<any>,
  });

  const language: 'sql' | 'lucene' = languageField.value ?? 'lucene';
  const isSql = language === 'sql';

  const handleLanguageChange = (lang: 'sql' | 'lucene') => {
    setStoredLanguage(lang);
    languageField.onChange(lang);
    onLanguageChange?.(lang);
  };

  const tc = tableConnection ? { tableConnection } : { tableConnections };
  const baseHeight =
    size === 'xs' ? EDITOR_INPUT_HEIGHTS.xs : EDITOR_INPUT_HEIGHTS.sm;

  return (
    <>
      <SyntaxReferenceModal
        opened={syntaxRefOpened}
        onClose={closeSyntaxRef}
        language={language}
      />
      <Box
        className={styles.root}
        style={{
          width,
          maxWidth,
          minWidth,
          ['--editor-base-height' as string]: `${baseHeight}px`,
        }}
      >
        {/* An open field overflows this box rather than growing it, so the page
            below does not jump. Kept as one box — not just the editor — so the
            language picker grows with the query, like the SQL label. */}
        <Flex className={styles.bar}>
          <Flex
            align="flex-start"
            className={styles.languageSwitch}
            data-testid="where-language-switch"
            onMouseDown={e => e.preventDefault()}
          >
            <Flex align="center" className={styles.languageSwitchRow}>
              <InputLanguageSwitch
                language={language}
                onLanguageChange={handleLanguageChange}
              />
              <Tooltip label="Syntax reference" withArrow position="top">
                <ActionIcon
                  variant="subtle"
                  size="xs"
                  aria-label="Open syntax reference"
                  onClick={openSyntaxRef}
                  style={{ marginRight: 4 }}
                >
                  <IconHelp size={14} />
                </ActionIcon>
              </Tooltip>
            </Flex>
          </Flex>
          <Box className={styles.inputWrapper}>
            {isSql ? (
              <SQLInlineEditorControlled
                {...tc}
                control={control}
                name={name}
                placeholder={sqlPlaceholder}
                onSubmit={onSubmit}
                queryHistoryType={sqlQueryHistoryType}
                enableHotkey={enableHotkey}
                allowMultiline={allowMultiline}
                floatOnOpen={false}
                size={size}
                additionalSuggestions={additionalSuggestions}
                dateRange={dateRange}
                sourceId={sourceId}
                parentRef={parentRef}
                enableVariables={enableVariables}
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
                allowMultiline={allowMultiline}
                floatOnOpen={false}
                size={size}
                data-testid={dataTestId}
                additionalSuggestions={additionalSuggestions}
                dateRange={dateRange}
                sourceId={sourceId}
                enableVariables={enableVariables}
              />
            )}
          </Box>
        </Flex>
      </Box>
    </>
  );
}
