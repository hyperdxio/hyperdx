import React, { useState } from 'react';
import { notifications } from '@mantine/notifications';
import {
  IconCopy,
  IconLayoutSidebarRightExpand,
  IconLink,
  IconTextWrap,
} from '@tabler/icons-react';

import { RowWhereResult } from '@/hooks/useRowWhere';
import {
  CLIPBOARD_ERROR_MESSAGE,
  copyTextToClipboard,
} from '@/utils/clipboard';

import { DBRowTableIconButton } from './DBRowTableIconButton';
import { toExportableRow } from './rowExport';

import styles from '@styles/LogTable.module.scss';

interface DBRowTableRowButtonsProps {
  row: Record<string, any>;
  getRowWhere: (row: Record<string, any>) => RowWhereResult;
  sourceId?: string;
  isWrapped: boolean;
  onToggleWrap: () => void;
  /** Omitted when clicking the row already opens the side panel. */
  onOpenSidePanel?: () => void;
}

const DBRowTableRowButtons: React.FC<DBRowTableRowButtonsProps> = ({
  row,
  getRowWhere,
  sourceId,
  isWrapped,
  onToggleWrap,
  onOpenSidePanel,
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const [isUrlCopied, setIsUrlCopied] = useState(false);

  const copyRowData = async () => {
    try {
      const rowData = JSON.stringify(toExportableRow(row), null, 2);
      const copied = await copyTextToClipboard(rowData);
      if (!copied) {
        notifications.show({
          color: 'red',
          message: CLIPBOARD_ERROR_MESSAGE,
        });
        return;
      }
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      notifications.show({
        color: 'red',
        message: CLIPBOARD_ERROR_MESSAGE,
      });
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
    const copied = await copyTextToClipboard(currentUrl.toString());
    if (!copied) {
      notifications.show({
        color: 'red',
        message: CLIPBOARD_ERROR_MESSAGE,
      });
      return;
    }
    setIsUrlCopied(true);
    setTimeout(() => setIsUrlCopied(false), 2000);
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
      {onOpenSidePanel && (
        <DBRowTableIconButton
          onClick={onOpenSidePanel}
          variant="copy"
          title="Open in side panel"
        >
          <IconLayoutSidebarRightExpand size={16} />
        </DBRowTableIconButton>
      )}
    </div>
  );
};

export default DBRowTableRowButtons;
