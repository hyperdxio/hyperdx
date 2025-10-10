import React, { useState } from 'react';
import { IconCopy, IconLink } from '@tabler/icons-react';

import DBRowTableIconButton from './DBRowTableIconButton';

import styles from '../../../styles/LogTable.module.scss';

export interface DBRowTableRowButtonsProps {
  row: Record<string, any>;
  getRowWhere: (row: Record<string, any>) => string;
  sourceId?: string;
}

export const DBRowTableRowButtons: React.FC<DBRowTableRowButtonsProps> = ({
  row,
  getRowWhere,
  sourceId,
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const [isUrlCopied, setIsUrlCopied] = useState(false);

  const copyRowData = async () => {
    try {
      const rowData = JSON.stringify(row, null, 2);
      await navigator.clipboard.writeText(rowData);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy row data to clipboard:', error);
      // Optionally show an error toast notification to the user
    }
  };

  const copyRowUrl = async () => {
    try {
      const rowWhere = getRowWhere(row);
      const currentUrl = new URL(window.location.href);
      // Add the row identifier as query parameters
      currentUrl.searchParams.set('rowWhere', rowWhere);
      if (sourceId) {
        currentUrl.searchParams.set('rowSource', sourceId);
      }
      await navigator.clipboard.writeText(currentUrl.toString());
      setIsUrlCopied(true);
      setTimeout(() => setIsUrlCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy URL to clipboard:', error);
      // Optionally show an error toast notification to the user
    }
  };

  return (
    <div className={styles.rowButtons}>
      <DBRowTableIconButton
        onClick={copyRowData}
        variant="copy"
        isActive={isCopied}
        title={
          isCopied ? 'Copied entire row as JSON!' : 'Copy entire row as JSON'
        }
      >
        <IconCopy size={12} />
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
        <IconLink size={12} />
      </DBRowTableIconButton>
    </div>
  );
};

export default DBRowTableRowButtons;
