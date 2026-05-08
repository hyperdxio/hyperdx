import * as React from 'react';
import cx from 'classnames';
import { atom, Provider, useAtomValue, useSetAtom } from 'jotai';
import { useHydrateAtoms } from 'jotai/utils';
import {
  isArray,
  isBoolean,
  isNull,
  isNumber,
  isPlainObject,
  isString,
} from 'lodash';
import { useHover } from '@mantine/hooks';
import {
  IconCaretDownFilled,
  IconCaretRightFilled,
  IconClipboard,
} from '@tabler/icons-react';

import styles from './HyperJson.module.scss';

/**
 * Repair the two malformations Berg sees in `payload`-style log dumps that
 * were stringified via Node's `util.inspect` rather than `JSON.stringify`:
 *
 *   1. Unquoted integer keys: `{1:"x"}`        -> `{"1":"x"}`
 *   2. Truncation literal:    `"k":...,`       -> `"k":null,`
 *
 * Walks the input as a state machine so repairs only fire OUTSIDE of quoted
 * strings — a substring like `"a,1:b"` inside a value is left untouched.
 * Returns the original string when it doesn't need repair.
 */
function repairLooseJson(s: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < s.length) {
    const c = s[i];
    if (inString) {
      if (c === '\\') {
        out += c + (s[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    // Repair `:...` truncation when followed by a structural char.
    if (c === ':') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (
        s[j] === '.' &&
        s[j + 1] === '.' &&
        s[j + 2] === '.' &&
        /[,}\]]/.test(s[j + 3] ?? '')
      ) {
        out += ':null';
        i = j + 3;
        continue;
      }
    }
    // Repair unquoted numeric keys: `{` or `,`, then digits, then `:`.
    if (c === '{' || c === ',') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      let k = j;
      while (k < s.length && s[k] >= '0' && s[k] <= '9') k++;
      if (k > j) {
        let m = k;
        while (m < s.length && /\s/.test(s[m])) m++;
        if (s[m] === ':') {
          out += c + s.slice(i + 1, j) + '"' + s.slice(j, k) + '"';
          i = k;
          continue;
        }
      }
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Try strict `JSON.parse`; on failure, attempt a one-shot repair pass and
 * parse again. Returns `undefined` when both attempts fail.
 */
function tolerantJsonParse(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    try {
      return JSON.parse(repairLooseJson(value));
    } catch {
      return undefined;
    }
  }
}

export type LineAction = {
  key: string;
  title?: string;
  label: React.ReactNode;
  onClick: () => void;
};

export type GetLineActions = (arg0: {
  key: string;
  keyPath: string[];
  value: any;
  isInParsedJson?: boolean;
  parsedJsonRootPath?: string[];
}) => LineAction[];

// Store common state in an atom so that it can be shared between components
// to avoid prop drilling
type HyperJsonAtom = {
  normallyExpanded: boolean;
  getLineActions?: GetLineActions;
};
const hyperJsonAtom = atom<HyperJsonAtom>({
  normallyExpanded: false,
});

const ValueRenderer = React.memo(
  React.forwardRef<HTMLSpanElement, { value: any }>(({ value }, ref) => {
    if (isNull(value)) {
      return (
        <span ref={ref} className={styles.null}>
          null
        </span>
      );
    }
    if (isString(value)) {
      return (
        <span ref={ref} className={styles.string}>
          {value}
        </span>
      );
    }
    if (isNumber(value)) {
      return (
        <span ref={ref} className={styles.number}>
          {value}
        </span>
      );
    }
    if (isBoolean(value)) {
      return (
        <span ref={ref} className={styles.boolean}>
          {value ? 'true' : 'false'}
        </span>
      );
    }
    if (isPlainObject(value)) {
      return (
        <span ref={ref} className={styles.object}>
          {'{}'} {Object.keys(value).length} keys
        </span>
      );
    }
    if (isArray(value)) {
      return (
        <span ref={ref} className={styles.array}>
          {'[]'} {value.length} items
        </span>
      );
    }
    return null;
  }),
);

const LineMenu = React.memo(
  ({
    keyName,
    keyPath,
    value,
    isInParsedJson,
    parsedJsonRootPath,
  }: {
    keyName: string;
    keyPath: string[];
    value: any;
    isInParsedJson?: boolean;
    parsedJsonRootPath?: string[];
  }) => {
    const { getLineActions } = useAtomValue(hyperJsonAtom);

    const lineActions = React.useMemo(() => {
      if (getLineActions) {
        return getLineActions({
          key: keyName,
          keyPath,
          value,
          isInParsedJson,
          parsedJsonRootPath,
        });
      }
      return [];
    }, [
      getLineActions,
      keyName,
      keyPath,
      value,
      isInParsedJson,
      parsedJsonRootPath,
    ]);

    return (
      <div className={styles.lineMenu}>
        {lineActions.map(action => (
          <button
            key={action.key}
            title={action.title}
            className={styles.lineMenuBtn}
            onClick={e => {
              action.onClick();
              e.stopPropagation();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    );
  },
);

const Line = React.memo(
  ({
    keyName,
    keyPath: parentKeyPath,
    value,
    disableMenu,
    isInParsedJson = false,
    parsedJsonRootPath,
  }: {
    keyName: string;
    keyPath: string[];
    value: any;
    disableMenu: boolean;
    isInParsedJson?: boolean;
    parsedJsonRootPath?: string[];
  }) => {
    const { normallyExpanded } = useAtomValue(hyperJsonAtom);

    // For performance reasons, render LineMenu only when hovered instead of
    // mounting it for potentially hundreds of lines
    const { ref, hovered } = useHover<HTMLDivElement>();

    // Parse once and reuse for both the "is JSON?" gate and the rendered tree.
    // `tolerantJsonParse` falls back to a structural repair pass for the
    // util.inspect-style dumps Berg sees in some payload columns.
    const parsedJsonValue = React.useMemo(() => {
      if (!isString(value)) return undefined;
      if (
        !(
          (value.startsWith('{') && value.endsWith('}')) ||
          (value.startsWith('[') && value.endsWith(']'))
        )
      ) {
        return undefined;
      }
      return tolerantJsonParse(value);
    }, [value]);

    const isStringValueValidJson = parsedJsonValue !== undefined;

    const [isExpanded, setIsExpanded] = React.useState(
      normallyExpanded && !isStringValueValidJson,
    );

    React.useEffect(() => {
      setIsExpanded(normallyExpanded && !isStringValueValidJson);
    }, [isStringValueValidJson, normallyExpanded]);

    const isExpandable = React.useMemo(
      () =>
        (isPlainObject(value) && Object.keys(value).length > 0) ||
        (isArray(value) && value.length > 0) ||
        isStringValueValidJson,
      [isStringValueValidJson, value],
    );

    const handleToggle = React.useCallback(() => {
      if (!isExpandable) return;
      setIsExpanded(prev => !prev);
    }, [isExpandable]);

    const expandedData = React.useMemo(() => {
      return isStringValueValidJson ? parsedJsonValue : value;
    }, [isStringValueValidJson, parsedJsonValue, value]);

    const nestedLevel = parentKeyPath.length;
    const keyPath = React.useMemo(
      () => [...parentKeyPath, keyName],
      [keyName, parentKeyPath],
    );

    // Determine the context for nested parsed JSON
    const childIsInParsedJson = isInParsedJson || isStringValueValidJson;
    const childParsedJsonRootPath = React.useMemo(() => {
      if (isStringValueValidJson) {
        // This is the start of a new parsed JSON context
        return keyPath;
      }
      return parsedJsonRootPath ?? [];
    }, [isStringValueValidJson, keyPath, parsedJsonRootPath]);

    // Hide LineMenu when selecting text in the value
    const valueRef = React.useRef<HTMLSpanElement>(null);
    const [isSelectingValue, setIsSelectingValue] = React.useState(false);
    const handleValueSelectStart = React.useCallback(() => {
      setIsSelectingValue(true);
    }, []);
    const handleValueMouseUp = React.useCallback(() => {
      setIsSelectingValue(false);
    }, []);
    React.useEffect(() => {
      const _valueRef = valueRef.current;
      _valueRef?.addEventListener('selectstart', handleValueSelectStart);
      _valueRef?.addEventListener('mouseup', handleValueMouseUp);
      return () => {
        _valueRef?.removeEventListener('selectstart', handleValueSelectStart);
        _valueRef?.removeEventListener('mouseup', handleValueMouseUp);
      };
    }, [handleValueMouseUp, handleValueSelectStart]);

    return (
      <>
        <div
          ref={ref}
          onClick={handleToggle}
          className={cx(styles.line, {
            [styles.nestedLine]: nestedLevel > 0,
            [styles.expanded]: isExpanded,
            [styles.expandable]: isExpandable,
          })}
          style={{ marginLeft: nestedLevel * 16 }}
          key={keyName}
        >
          <div className={styles.keyContainer}>
            <div className={styles.key}>
              {isExpandable &&
                (isExpanded ? (
                  <IconCaretDownFilled size={10} />
                ) : (
                  <IconCaretRightFilled size={10} />
                ))}
              {keyName}
              <div className={styles.hoverContent}>
                <IconClipboard size={14} />
              </div>
            </div>
          </div>
          <div className={styles.valueContainer}>
            {isStringValueValidJson ? (
              isExpanded ? (
                <div className={styles.object}>{'{}'} Parsed JSON</div>
              ) : (
                <>
                  <ValueRenderer value={value} ref={valueRef} />
                  <div className={styles.jsonBtn}>Expand JSON</div>
                </>
              )
            ) : (
              <ValueRenderer value={value} ref={valueRef} />
            )}
          </div>
          {hovered && !disableMenu && !isSelectingValue && (
            <LineMenu
              keyName={keyName}
              keyPath={keyPath}
              value={value}
              isInParsedJson={isInParsedJson}
              parsedJsonRootPath={parsedJsonRootPath}
            />
          )}
        </div>
        {isExpanded && isExpandable && (
          <TreeNode
            data={expandedData}
            keyPath={keyPath}
            disableMenu={disableMenu}
            isInParsedJson={childIsInParsedJson}
            parsedJsonRootPath={childParsedJsonRootPath}
          />
        )}
      </>
    );
  },
);

const MAX_TREE_NODE_ITEMS = 50;
function TreeNode({
  data,
  keyPath: _keyPath,
  disableMenu = false,
  isInParsedJson = false,
  parsedJsonRootPath,
}: {
  data: object;
  keyPath?: string[];
  disableMenu?: boolean;
  isInParsedJson?: boolean;
  parsedJsonRootPath?: string[];
}) {
  const [isExpanded, setIsExpanded] = React.useState(false);

  const keyPath = React.useMemo(() => _keyPath ?? [], [_keyPath]);

  const originalLength = React.useMemo(() => Object.keys(data).length, [data]);
  const visibleLines = React.useMemo(() => {
    return isExpanded
      ? Object.entries(data)
      : Object.entries(data).slice(0, MAX_TREE_NODE_ITEMS);
  }, [data, isExpanded]);
  const nestedLevel = keyPath?.length || 0;

  return (
    <>
      {visibleLines.map(([key, value]) => (
        <Line
          key={key}
          keyName={key}
          value={value}
          keyPath={keyPath}
          disableMenu={disableMenu}
          isInParsedJson={isInParsedJson}
          parsedJsonRootPath={parsedJsonRootPath}
        />
      ))}
      {originalLength > MAX_TREE_NODE_ITEMS && !isExpanded && (
        <div
          className={cx(styles.line, styles.nestedLine, styles.expandable)}
          style={{ marginLeft: nestedLevel * 16 }}
          onClick={() => setIsExpanded(true)}
        >
          <div className={styles.keyContainer}>
            <div className={styles.jsonBtn}>
              Expand {originalLength - MAX_TREE_NODE_ITEMS} more properties
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Hydrate + allow to use this component multiple times on the same page
const HydrateAtoms = ({
  children,
  initialValues,
}: {
  initialValues: HyperJsonAtom;
  children: React.ReactElement;
}) => {
  useHydrateAtoms([[hyperJsonAtom, initialValues]]);
  const set = useSetAtom(hyperJsonAtom);
  React.useEffect(() => {
    set(initialValues);
  }, [initialValues, set]);
  return children;
};

type HyperJsonProps = {
  data: object;
  normallyExpanded?: boolean;
  tabulate?: boolean;
  whiteSpace?: 'pre' | 'pre-wrap';
  getLineActions?: GetLineActions;
};

const HyperJson = ({
  data,
  normallyExpanded = false,
  tabulate = false,
  whiteSpace = 'pre-wrap',
  getLineActions,
}: HyperJsonProps) => {
  const isEmpty = React.useMemo(() => Object.keys(data).length === 0, [data]);

  return (
    <Provider>
      <HydrateAtoms initialValues={{ normallyExpanded, getLineActions }}>
        <div
          className={cx(styles.container, {
            [styles.withTabulate]: tabulate,
            [styles.withPreWrap]: whiteSpace === 'pre-wrap',
          })}
        >
          {isEmpty ? <div>Empty</div> : <TreeNode data={data} />}
        </div>
      </HydrateAtoms>
    </Provider>
  );
};

export default HyperJson;
