import { useMemo } from 'react';
import { FieldPath, useController, UseControllerProps } from 'react-hook-form';
import { TableConnectionChoice } from '@hyperdx/common-utils/dist/core/metadata';
import { ActionIcon, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconHelp } from '@tabler/icons-react';

import { getStoredLanguage } from '@/components/SearchInput/SearchWhereInput';
import SyntaxReferenceModal from '@/components/SearchInput/SyntaxReferenceModal';
import { useMultipleAllFields } from '@/hooks/useMetadata';
import { useSource } from '@/source';

import { QueryEditor, QueryLanguage } from './QueryEditor';

const STORAGE_KEY = 'hdx-search-where-language';

function setStoredLanguage(lang: QueryLanguage): void {
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
  dateRange?: [Date, Date];
  sourceId?: string;
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
 * Explore-only query editor. Wraps the presentational QueryEditor with
 * react-hook-form wiring, the ClickHouse field list for autocomplete, and the
 * shared syntax-reference modal. Kept separate from SearchWhereInput so the
 * Explore layout can evolve without affecting the Search page.
 */
export function ExploreQueryEditor({
  tableConnection,
  tableConnections,
  control,
  name,
  onSubmit,
  enableHotkey,
  dateRange,
  sourceId,
  additionalSuggestions,
  languageName = `${name}Language`,
  isExpanded,
  onToggleExpand,
  controls,
  'data-testid': dataTestId,
}: ExploreQueryEditorProps) {
  const [syntaxRefOpened, { open: openSyntaxRef, close: closeSyntaxRef }] =
    useDisclosure(false);

  const { field: valueField } = useController({
    control,
    name: name as FieldPath<any>,
  });
  const { field: languageField } = useController({
    control,
    name: languageName as FieldPath<any>,
  });

  const language: QueryLanguage =
    languageField.value ?? getStoredLanguage() ?? 'sql';

  const handleLanguageChange = (lang: QueryLanguage) => {
    setStoredLanguage(lang);
    languageField.onChange(lang);
  };

  const _tableConnections = tableConnection
    ? [tableConnection]
    : tableConnections;
  const { data: source } = useSource({ id: sourceId });
  const { data: fields } = useMultipleAllFields(_tableConnections ?? [], {
    dateRange,
    timestampValueExpression: source?.timestampValueExpression,
  });

  const identifiers = useMemo(() => {
    return [
      ...(fields?.map(c =>
        c.path.length > 1 ? `${c.path[0]}['${c.path[1]}']` : c.path[0],
      ) ?? []),
      ...(additionalSuggestions ?? []),
    ];
  }, [fields, additionalSuggestions]);

  const stringValue =
    typeof valueField.value === 'string' ? valueField.value : '';

  return (
    <>
      <SyntaxReferenceModal
        opened={syntaxRefOpened}
        onClose={closeSyntaxRef}
        language={language}
      />
      <QueryEditor
        value={stringValue}
        onChange={valueField.onChange}
        language={language}
        onLanguageChange={handleLanguageChange}
        languages={['sql', 'lucene']}
        expanded={isExpanded}
        onToggleExpanded={onToggleExpand}
        rightSection={controls}
        leftSection={
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
        }
        fields={identifiers}
        placeholder={
          language === 'sql'
            ? "SQL WHERE clause (ex. column = 'foo')"
            : 'Search your events w/ Lucene ex. column:foo'
        }
        onSubmit={onSubmit}
        enableHotkey={enableHotkey}
        data-testid={dataTestId}
      />
    </>
  );
}
