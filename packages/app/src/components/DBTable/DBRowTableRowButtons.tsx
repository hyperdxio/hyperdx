import React, { useState } from 'react';
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
    if (ok) {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
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
    if (ok) {
      setIsUrlCopied(true);
      setTimeout(() => setIsUrlCopied(false), 2000);
    }
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
      >
        <IconLink size={16} />
      </DBRowTableIconButton>
    </div>
  );
};

export default DBRowTableRowButtons;
