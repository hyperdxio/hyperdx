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

import styles from './HyperJson.module.scss';

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

const ValueRenderer = React.memo(({ value }: { value: any }) => {
  if (isNull(value)) {
    return <span className={styles.null}>null</span>;
  }
  if (isString(value)) {
    return <span className={styles.string}>{value}</span>;
  }
  if (isNumber(value)) {
    return <span className={styles.number}>{value}</span>;
  }
  if (isBoolean(value)) {
    return <span className={styles.boolean}>{value ? 'true' : 'false'}</span>;
  }
  if (isPlainObject(value)) {
    return (
      <span className={styles.object}>
        {'{}'} {Object.keys(value).length} keys
      </span>
    );
  }
  if (isArray(value)) {
    return (
      <span className={styles.array}>
        {'[]'} {value.length} items
      </span>
    );
  }
  return null;
});

const LineMenu = React.memo(
  ({
    keyName,
    keyPath,
    value,
  }: {
    keyName: string;
    keyPath: string[];
    value: any;
  }) => {
    const { getLineActions } = useAtomValue(hyperJsonAtom);

    const lineActions = React.useMemo(() => {
      if (getLineActions) {
        return getLineActions({ key: keyName, keyPath, value });
      }
      return [];
    }, [getLineActions, keyName, keyPath, value]);

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
  }: {
    keyName: string;
    keyPath: string[];
    value: any;
    disableMenu: boolean;
  }) => {
    const { normallyExpanded } = useAtomValue(hyperJsonAtom);

    // For performance reasons, render LineMenu only when hovered instead of
    // mounting it for potentially hundreds of lines
    const { ref, hovered } = useHover<HTMLDivElement>();

    const isStringValueJsonLike = React.useMemo(() => {
      if (!isString(value)) return false;
      return (
        (value.startsWith('{') && value.endsWith('}')) ||
        (value.startsWith('[') && value.endsWith(']'))
      );
    }, [value]);

    const [isExpanded, setIsExpanded] = React.useState(
      normallyExpanded && !isStringValueJsonLike,
    );

    React.useEffect(() => {
      setIsExpanded(normallyExpanded && !isStringValueJsonLike);
    }, [isStringValueJsonLike, normallyExpanded]);

    const isExpandable = React.useMemo(
      () =>
        (isPlainObject(value) && Object.keys(value).length > 0) ||
        (isArray(value) && value.length > 0) ||
        isStringValueJsonLike,
      [isStringValueJsonLike, value],
    );

    const handleToggle = React.useCallback(() => {
      if (!isExpandable) return;
      setIsExpanded(prev => !prev);
    }, [isExpandable]);

    const expandedData = React.useMemo(() => {
      if (isStringValueJsonLike) {
        try {
          return JSON.parse(value);
        } catch (e) {
          return null;
        }
      }
      return value;
    }, [isStringValueJsonLike, value]);

    const nestedLevel = parentKeyPath.length;
    const keyPath = React.useMemo(
      () => [...parentKeyPath, keyName],
      [keyName, parentKeyPath],
    );

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
                  <i className="bi bi-caret-down-fill fs-9"></i>
                ) : (
                  <i className="bi bi-caret-right-fill fs-9"></i>
                ))}
              {keyName}
              <div className={styles.hoverContent}>
                <i className="bi bi-clipboard" />
              </div>
            </div>
          </div>
          <div className={styles.valueContainer}>
            {isStringValueJsonLike ? (
              isExpanded ? (
                <div className={styles.object}>{'{}'} Parsed JSON</div>
              ) : (
                <>
                  <ValueRenderer value={value} />
                  <div className={styles.jsonBtn}>Looks like JSON. Parse?</div>
                </>
              )
            ) : (
              <ValueRenderer value={value} />
            )}
          </div>
          {hovered && !disableMenu && (
            <LineMenu keyName={keyName} keyPath={keyPath} value={value} />
          )}
        </div>
        {isExpanded && isExpandable && (
          <TreeNode
            data={expandedData}
            keyPath={keyPath}
            disableMenu={isStringValueJsonLike}
          />
        )}
      </>
    );
  },
);

const MAX_TREE_NODE_ITEMS = 50;
function TreeNode({
  data,
  keyPath = [],
  disableMenu = false,
}: {
  data: object;
  keyPath?: string[];
  disableMenu?: boolean;
}) {
  const [isExpanded, setIsExpanded] = React.useState(false);

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
  lineWrap?: boolean;
  getLineActions?: GetLineActions;
};

const HyperJson = ({
  data,
  normallyExpanded = false,
  tabulate = false,
  lineWrap,
  getLineActions,
}: HyperJsonProps) => {
  const isEmpty = React.useMemo(() => Object.keys(data).length === 0, [data]);

  return (
    <Provider>
      <HydrateAtoms initialValues={{ normallyExpanded, getLineActions }}>
        <div
          className={cx(styles.container, {
            [styles.withTabulate]: tabulate,
            [styles.withLineWrap]: lineWrap,
          })}
        >
          {isEmpty ? (
            <div className="text-slate-400">Empty</div>
          ) : (
            <TreeNode data={data} />
          )}
        </div>
      </HydrateAtoms>
    </Provider>
  );
};

export default HyperJson;
