import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import { useController, UseControllerProps } from 'react-hook-form';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  Completion,
  startCompletion,
} from '@codemirror/autocomplete';
import { sql } from '@codemirror/lang-sql';
import {
  Field,
  TableConnectionChoice,
} from '@hyperdx/common-utils/dist/core/metadata';
import {
  Flex,
  Paper,
  Text,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import CodeMirror, {
  Compartment,
  EditorView,
  keymap,
  Prec,
  ReactCodeMirrorRef,
  tooltips,
} from '@uiw/react-codemirror';

import InputLanguageSwitch from '@/components/SearchInput/InputLanguageSwitch';
import { useMultipleAllFields } from '@/hooks/useMetadata';
import { useQueryHistory } from '@/utils';

import { KEYWORDS_FOR_WHERE_OR_ORDER_BY } from './constants';
import {
  createCodeMirrorSqlDialect,
  createCodeMirrorStyleTheme,
  DEFAULT_CODE_MIRROR_BASIC_SETUP,
} from './utils';

import styles from './SQLInlineEditor.module.scss';

type SQLInlineEditorProps = {
  filterField?: (field: Field) => boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onLanguageChange?: (language: 'sql' | 'lucene') => void;
  language?: 'sql' | 'lucene';
  onSubmit?: () => void;
  error?: React.ReactNode;
  size?: string;
  label?: React.ReactNode;
  disableKeywordAutocomplete?: boolean;
  enableHotkey?: boolean;
  tooltipText?: string;
  additionalSuggestions?: string[];
  queryHistoryType?: string;
  parentRef?: HTMLElement | null;
  allowMultiline?: boolean;
};

const MAX_EDITOR_HEIGHT = '150px';

export default function SQLInlineEditor({
  tableConnection,
  tableConnections,
  filterField,
  onChange,
  placeholder,
  onLanguageChange,
  language,
  onSubmit,
  error,
  value,
  size,
  label,
  disableKeywordAutocomplete,
  enableHotkey,
  tooltipText,
  additionalSuggestions,
  queryHistoryType,
  parentRef,
  allowMultiline = true,
}: SQLInlineEditorProps & TableConnectionChoice) {
  const { colorScheme } = useMantineColorScheme();
  const _tableConnections = tableConnection
    ? [tableConnection]
    : tableConnections;
  const { data: fields } = useMultipleAllFields(_tableConnections ?? []);
  const filteredFields = useMemo(() => {
    return filterField ? fields?.filter(filterField) : fields;
  }, [fields, filterField]);

  // query search history
  const [queryHistory, setQueryHistory] = useQueryHistory(queryHistoryType);

  const onSelectSearchHistory = useCallback(
    (view: EditorView, from: number, to: number, q: string) => {
      // update history into search bar
      view.dispatch({
        changes: { from, to, insert: q },
      });
      // close history bar;
      closeCompletion(view);
      // update history order
      setQueryHistory(q);
      // execute search
      if (onSubmit) onSubmit();
    },
    [onSubmit, setQueryHistory],
  );

  const createHistoryList = useMemo(() => {
    return () => {
      return {
        from: 0,
        options: queryHistory.map(q => {
          return {
            label: q,
            section: 'Search History',
            type: 'keyword',
            apply: (
              view: EditorView,
              _completion: Completion,
              from: number,
              to: number,
            ) => {
              onSelectSearchHistory(view, from, to, q);
            },
          };
        }),
      };
    };
  }, [queryHistory, onSelectSearchHistory]);

  const [isFocused, setIsFocused] = useState(false);

  const ref = useRef<ReactCodeMirrorRef>(null);

  const compartmentRef = useRef<Compartment>(new Compartment());

  const updateAutocompleteColumns = useCallback(
    (viewRef: EditorView) => {
      const currentText = viewRef.state.doc.toString();
      const identifiers = [
        ...(filteredFields?.map(column => {
          if (column.path.length > 1) {
            return `${column.path[0]}['${column.path[1]}']`;
          }
          return column.path[0];
        }) ?? []),
        ...(additionalSuggestions ?? []),
      ];

      const auto = createCodeMirrorSqlDialect({
        identifiers,
        keywords: KEYWORDS_FOR_WHERE_OR_ORDER_BY,
        includeRegularFunctions: !disableKeywordAutocomplete,
      });

      const queryHistoryList = autocompletion({
        compareCompletions: (a: any, b: any) => {
          return 0;
        }, // don't sort the history search
        override: [createHistoryList],
      });
      viewRef.dispatch({
        effects: compartmentRef.current.reconfigure(
          currentText.length > 0 ? auto : queryHistoryList,
        ),
      });
    },
    [
      filteredFields,
      additionalSuggestions,
      createHistoryList,
      disableKeywordAutocomplete,
    ],
  );

  useEffect(() => {
    if (ref.current != null && ref.current.view != null) {
      updateAutocompleteColumns(ref.current.view);
    }
    // Otherwise we'll update the columns in `onCreateEditor` hook
  }, [updateAutocompleteColumns]);

  useHotkeys(
    ['/', 's'],
    () => {
      if (enableHotkey) {
        ref.current?.view?.focus();
      }
    },
    {
      preventDefault: true,
      enableOnFormTags: false,
      enableOnContentEditable: false,
    },
    [enableHotkey],
  );

  /**
   * If the editor is inside a modal, we need to position the tooltip
   * relative to the modal. This ensures that the autocompletion results
   * are properly calculated off the correct element.
   */
  const tooltipExt = useMemo(() => {
    if (parentRef == null) {
      return [];
    }
    return [
      tooltips({
        parent: parentRef,
        tooltipSpace: view => {
          const box = view.dom.getBoundingClientRect();
          const parentBox = parentRef.getBoundingClientRect();
          return {
            ...box,
            right: box.right ?? 0,
            left: parentBox.left ?? box.left,
            top: parentBox.top ?? box.top,
            bottom: parentBox.bottom ?? box.bottom,
          };
        },
      }),
    ];
  }, [parentRef]);

  const cmExtensions = useMemo(
    () => [
      ...tooltipExt,
      createCodeMirrorStyleTheme(MAX_EDITOR_HEIGHT),

      // Enable line wrapping when multiline is allowed (regardless of focus)
      ...(allowMultiline ? [EditorView.lineWrapping] : []),

      // eslint-disable-next-line react-hooks/refs
      compartmentRef.current.of(
        sql({
          upperCaseKeywords: true,
        }),
      ),

      // Configure Enter key to submit search, and Shift + Enter to insert new line when multiline is allowed
      Prec.highest(
        keymap.of([
          {
            key: 'Enter',
            run: () => {
              if (onSubmit == null) {
                return false;
              }
              if (queryHistoryType && ref?.current?.view) {
                setQueryHistory(ref?.current?.view.state.doc.toString());
              }
              onSubmit();
              return true;
            },
          },
          ...(allowMultiline
            ? [
                {
                  key: 'Shift-Enter',
                  run: () => {
                    // Allow default behavior (insert new line)
                    return false;
                  },
                },
              ]
            : []),
        ]),
      ),
      keymap.of([
        {
          key: 'Tab',
          run: acceptCompletion,
        },
      ]),
    ],
    [allowMultiline, onSubmit, queryHistoryType, setQueryHistory, tooltipExt],
  );

  const onClickCodeMirror = useCallback(() => {
    if (ref?.current?.view) {
      startCompletion(ref.current.view);
    }
  }, []);

  // Only apply expanded styling when multiline is enabled and focused
  const isExpanded = allowMultiline && isFocused;
  const baseHeight = size === 'xs' ? 32 : 36;

  return (
    <div
      className={styles.wrapper}
      style={{ ['--editor-base-height' as string]: `${baseHeight}px` }}
      data-expanded={isExpanded ? 'true' : undefined}
    >
      {/* When expanded, Paper is absolute; this keeps the wrapper width stable */}
      {isExpanded && <div className={styles.placeholder} aria-hidden="true" />}
      <Paper
        shadow="none"
        className={cx(
          styles.paper,
          error ? styles.error : undefined,
          isExpanded ? styles.expanded : undefined,
          allowMultiline && !isExpanded ? styles.collapseFade : undefined,
        )}
        ps="4px"
      >
        {label != null && (
          <Text
            mx="4px"
            size="xs"
            fw="bold"
            className={cx(
              styles.label,
              size === 'xs' ? styles.sizeXs : undefined,
            )}
            component="div"
          >
            <Tooltip label={tooltipText} disabled={!tooltipText}>
              <Flex align="center" gap={2}>
                {label}
                {tooltipText && <IconInfoCircle size={16} />}
              </Flex>
            </Tooltip>
          </Text>
        )}
        <div
          className={cx(
            styles.cmWrapper,
            size === 'xs' ? styles.sizeXs : undefined,
            !isExpanded ? styles.collapsed : undefined,
            isExpanded ? 'cm-editor-multiline' : undefined,
          )}
        >
          <CodeMirror
            indentWithTab={false}
            ref={ref}
            value={value}
            onChange={onChange}
            theme={colorScheme === 'dark' ? 'dark' : 'light'}
            onFocus={useCallback(() => {
              setIsFocused(true);
            }, [setIsFocused])}
            onBlur={useCallback(() => {
              setIsFocused(false);
            }, [setIsFocused])}
            extensions={cmExtensions}
            onCreateEditor={updateAutocompleteColumns}
            basicSetup={DEFAULT_CODE_MIRROR_BASIC_SETUP}
            placeholder={placeholder}
            onClick={onClickCodeMirror}
          />
        </div>
        {onLanguageChange != null && language != null && (
          <div className={styles.languageSwitchWrapper}>
            <InputLanguageSwitch
              language={language}
              onLanguageChange={onLanguageChange}
            />
          </div>
        )}
      </Paper>
    </div>
  );
}

function SQLInlineEditorControlledComponent({
  placeholder,
  filterField,
  additionalSuggestions,
  queryHistoryType,
  ...props
}: Omit<SQLInlineEditorProps, 'value' | 'onChange'> &
  UseControllerProps<any> &
  TableConnectionChoice) {
  const { field, fieldState } = useController(props);

  // Guard against wrongly typed values
  const value = field.value || props.defaultValue;

  let stringValue = '';
  if (typeof value === 'string') {
    stringValue = value;
  } else if (value !== undefined) {
    console.error('SQLInlineEditor: value is not a string', value);
  }

  return (
    <SQLInlineEditor
      filterField={filterField}
      onChange={field.onChange}
      placeholder={placeholder}
      value={stringValue}
      error={fieldState.error?.message}
      additionalSuggestions={additionalSuggestions}
      queryHistoryType={queryHistoryType}
      {...props}
    />
  );
}
export const SQLInlineEditorControlled = memo(
  SQLInlineEditorControlledComponent,
);
