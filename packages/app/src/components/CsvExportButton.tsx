import React, { useCallback } from 'react';
import Papa from 'papaparse';

import { downloadTextFile } from '@/utils/downloadFile';

interface CsvExportButtonProps {
  data: Record<string, any>[];
  filename: string | (() => string);
  children: React.ReactNode;
  className?: string;
  title?: string;
  disabled?: boolean;
  onExportStart?: () => void;
  onExportComplete?: () => void;
  onExportError?: (error: Error) => void;
}

export const CsvExportButton: React.FC<CsvExportButtonProps> = ({
  data,
  filename,
  children,
  className,
  title,
  disabled = false,
  onExportStart,
  onExportComplete,
  onExportError,
}) => {
  const handleClick = useCallback(() => {
    try {
      if (data.length === 0) {
        onExportError?.(new Error('No data to export'));
        return;
      }

      onExportStart?.();

      const csv = Papa.unparse(data, {
        quotes: true,
        quoteChar: '"',
        escapeChar: '"',
        delimiter: ',',
        header: true,
      });
      // Leading BOM so Excel reads the file as UTF-8.
      downloadTextFile(
        `\ufeff${csv}`,
        typeof filename === 'string' ? `${filename}.csv` : `${filename()}.csv`,
        'text/csv;charset=utf-8;',
      );

      onExportComplete?.();
    } catch (error) {
      onExportError?.(
        error instanceof Error ? error : new Error('Export failed'),
      );
    }
  }, [data, filename, onExportStart, onExportComplete, onExportError]);

  if (disabled || data.length === 0) {
    return (
      <div
        className={className}
        title={disabled ? 'Export disabled' : 'No data to export'}
        style={{ opacity: 0.5, cursor: 'not-allowed', display: 'flex' }}
      >
        {children}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      className={className}
      style={{
        color: 'inherit',
        textDecoration: 'none',
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      {children}
    </button>
  );
};
