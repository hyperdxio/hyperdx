import React, { useEffect, useRef, useState } from 'react';
import { IconCopy, IconLink, IconTextWrap } from '@tabler/icons-react';

import { INTERNAL_ROW_FIELDS, RowWhereResult } from '@/hooks/useRowWhere';
import { copyTextWithToast } from '@/utils/clipboard';

import { DBRowTableIconButton } from './DBRowTableIconButton';

import styles from '../../../styles/LogTable.module.scss';

interface DBRowTableRowButtonsProps {
  row: Record<string, any>;
  getRowWhere: (row: Record<string, any>) => RowWhereResult;
  sourceId?: string;
  isWrapped: boolean;
  onToggleWrap: () => void;
}

const DBRowTableRowButtons: React.FC<DBRowTableRowButtonsProps> = ({
  row,
  getRowWhere,
  sourceId,
  isWrapped,
  onToggleWrap,
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const [isUrlCopied, setIsUrlCopied] = useState(false);
  // Rows are virtualised and recycle on scroll; cancel pending state resets on
  // unmount so we don't setState on a recycled row.
  const copyResetRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const urlCopyResetRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      if (urlCopyResetRef.current) clearTimeout(urlCopyResetRef.current);
    };
  }, []);

  const copyRowData = async () => {
    // Filter out internal metadata fields that start with __ or are generated IDs
    const { [INTERNAL_ROW_FIELDS.ID]: _id, ...cleanRow } = row;

    // Parse JSON string fields to make them proper JSON objects
    const parsedRow = Object.entries(cleanRow).reduce(
      (acc, [key, value]) => {
        if (
          typeof value === 'string' &&
          (value.startsWith('{') || value.startsWith('['))
        ) {
          try {
            acc[key] = JSON.parse(value);
          } catch {
            // If parsing fails, keep the original string
            acc[key] = value;
          }
        } else {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, any>,
    );

    const rowData = JSON.stringify(parsedRow, null, 2);
    const ok = await copyTextWithToast(rowData, 'Copied row as JSON');
    if (!ok || !isMountedRef.current) return;
    setIsCopied(true);
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => {
      if (isMountedRef.current) setIsCopied(false);
    }, 2000);
  };

  const copyRowUrl = async () => {
    const rowWhereResult = getRowWhere(row);
    const currentUrl = new URL(window.location.href);
    // Add the row identifier as query parameters
    currentUrl.searchParams.set('rowWhere', rowWhereResult.where);
    if (sourceId) {
      currentUrl.searchParams.set('rowSource', sourceId);
    }
    const ok = await copyTextWithToast(
      currentUrl.toString(),
      'Copied shareable link',
    );
    if (!ok || !isMountedRef.current) return;
    setIsUrlCopied(true);
    if (urlCopyResetRef.current) clearTimeout(urlCopyResetRef.current);
    urlCopyResetRef.current = setTimeout(() => {
      if (isMountedRef.current) setIsUrlCopied(false);
    }, 2000);
  };

  return (
    <div className={styles.rowButtons}>
      {!isWrapped && (
        <DBRowTableIconButton
          onClick={onToggleWrap}
          variant="copy"
          title="Wrap All Lines"
        >
          <IconTextWrap size={16} />
        </DBRowTableIconButton>
      )}
      <DBRowTableIconButton
        onClick={copyRowData}
        variant="copy"
        isActive={isCopied}
        title={
          isCopied ? 'Copied entire row as JSON!' : 'Copy entire row as JSON'
        }
        data-testid="row-copy-json-button"
      >
        <IconCopy size={16} />
      </DBRowTableIconButton>
      <DBRowTableIconButton
        onClick={copyRowUrl}
        variant="copy"
        isActive={isUrlCopied}
        title={
          isUrlCopied
            ? 'Copied shareable link!'
            : 'Copy shareable link to this specific row'
        }
        data-testid="row-copy-link-button"
      >
        <IconLink size={16} />
      </DBRowTableIconButton>
    </div>
  );
};

export default DBRowTableRowButtons;
