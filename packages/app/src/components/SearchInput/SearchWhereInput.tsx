import { useController, UseControllerProps } from 'react-hook-form';
import { TableConnectionChoice } from '@hyperdx/common-utils/dist/core/metadata';
import { Box, Flex } from '@mantine/core';

import InputLanguageSwitch from './InputLanguageSwitch';
import SearchInputV2 from './SearchInputV2';
import { SQLInlineEditorControlled } from './SQLInlineEditor';

import styles from './SearchWhereInput.module.scss';

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
   * Enable keyboard shortcut (/) to focus the input
   */
  enableHotkey?: boolean;
  /**
   * Size of the input
   */
  size?: 'xs' | 'sm';
  /**
   * Show WHERE label on SQL input
   */
  showLabel?: boolean;
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
   * Test ID for the input
   */
  'data-testid'?: string;
} & TableConnectionChoice &
  UseControllerProps<any>;

/**
 * A unified search input component that handles both SQL and Lucene modes.
 *
 * This component expects two form fields:
 * - `name` (e.g., "where") - The actual search query value
 * - A corresponding language field (e.g., "whereLanguage") - Controls which mode is active
 *
 * The component reads the language from `{name}Language` field automatically.
 *
 * @example
 * ```tsx
 * <SearchWhereInput
 *   tableConnection={tcFromSource(source)}
 *   control={control}
 *   name="where"
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
  allowMultiline = true,
  sqlQueryHistoryType,
  luceneQueryHistoryType,
  sqlPlaceholder = "SQL WHERE clause (ex. column = 'foo')",
  lucenePlaceholder = 'Search your events w/ Lucene ex. column:foo',
  width = '100%',
  maxWidth = '100%',
  'data-testid': dataTestId,
  ...props
}: SearchWhereInputProps) {
  // Read the language value from the corresponding language field
  const languageFieldName = `${name}Language` as any;
  const { field: languageField } = useController({
    control,
    name: languageFieldName,
  });

  const language: 'sql' | 'lucene' = languageField.value ?? 'lucene';
  const isSql = language === 'sql';

  const handleLanguageChange = (lang: 'sql' | 'lucene') => {
    languageField.onChange(lang);
    onLanguageChange?.(lang);
  };

  const tc = tableConnection ? { tableConnection } : { tableConnections };

  return (
    <Box className={styles.root} style={{ width, maxWidth }}>
      <Box className={styles.inputWrapper}>
        {isSql ? (
          <SQLInlineEditorControlled
            {...tc}
            control={control}
            name={name}
            placeholder={sqlPlaceholder}
            onSubmit={onSubmit}
            label={showLabel ? 'WHERE' : undefined}
            queryHistoryType={sqlQueryHistoryType}
            enableHotkey={enableHotkey}
            allowMultiline={allowMultiline}
            size={size}
            {...props}
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
            {...props}
          />
        )}
      </Box>
      <Flex
        align="center"
        className={`${styles.languageSwitch} ${size === 'xs' ? styles.sizeXs : styles.sizeSm}`}
        onMouseDown={e => e.preventDefault()}
      >
        <InputLanguageSwitch
          language={language}
          onLanguageChange={handleLanguageChange}
        />
      </Flex>
    </Box>
  );
}
