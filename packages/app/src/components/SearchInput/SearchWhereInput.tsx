import { FieldPath, useController, UseControllerProps } from 'react-hook-form';
import { TableConnectionChoice } from '@hyperdx/common-utils/dist/core/metadata';
import { Box, Flex, Kbd } from '@mantine/core';

import InputLanguageSwitch from './InputLanguageSwitch';
import SearchInputV2 from './SearchInputV2';
import { SQLInlineEditorControlled } from './SQLInlineEditor';

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
   * Show label on SQL input (default true). Use label to customize text (e.g. "GLOBAL WHERE").
   */
  showLabel?: boolean;
  /**
   * Label text when showLabel is true (default "WHERE")
   */
  label?: string;
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
   * Form field name for the language value ('sql' | 'lucene').
   * If not provided, defaults to `${name}Language` (e.g. name="where" → "whereLanguage").
   */
  languageName?: string;
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
  showLabel = true,
  label: labelText = 'WHERE',
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
  languageName = `${name}Language`,
}: SearchWhereInputProps) {
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
  const sizeClass = size === 'xs' ? styles.sizeXs : styles.sizeSm;

  return (
    <Box
      className={styles.root}
      style={{
        width,
        maxWidth,
        minWidth,
      }}
    >
      <Flex
        align="center"
        className={`${styles.languageSwitch} ${sizeClass}`}
        data-testid="where-language-switch"
        onMouseDown={e => e.preventDefault()}
      >
        <InputLanguageSwitch
          language={language}
          onLanguageChange={handleLanguageChange}
        />
      </Flex>
      <Box className={`${styles.inputWrapper} ${sizeClass}`}>
        {isSql ? (
          <SQLInlineEditorControlled
            {...tc}
            control={control}
            name={name}
            placeholder={sqlPlaceholder}
            onSubmit={onSubmit}
            label={showLabel ? labelText : undefined}
            queryHistoryType={sqlQueryHistoryType}
            enableHotkey={enableHotkey}
            allowMultiline={allowMultiline}
            size={size}
            additionalSuggestions={additionalSuggestions}
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
          />
        )}
        {enableHotkey && (
          <Box
            className={styles.shortcutHint}
            title="Press / or s to focus search"
            aria-hidden
          >
            <Kbd size="xs">/</Kbd>
          </Box>
        )}
      </Box>
    </Box>
  );
}
