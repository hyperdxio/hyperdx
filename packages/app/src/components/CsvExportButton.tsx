import React, { useCallback } from 'react';
import Papa from 'papaparse';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation('common');
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
      const blob = new Blob([`\ufeff${csv}`], {
        type: 'text/csv;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download =
        typeof filename === 'string' ? `${filename}.csv` : `${filename()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

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
        title={disabled ? t('export.disabled') : t('export.noData')}
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
