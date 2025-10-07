import React from 'react';
import { useCSVDownloader } from 'react-papaparse';
import { UnstyledButton } from '@mantine/core';

interface CsvExportButtonProps {
  data: Record<string, any>[];
  filename: string;
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
  ...props
}) => {
  const { CSVDownloader } = useCSVDownloader();

  const handleClick = () => {
    try {
      if (data.length === 0) {
        onExportError?.(new Error('No data to export'));
        return;
      }

      onExportStart?.();
      onExportComplete?.();
    } catch (error) {
      onExportError?.(
        error instanceof Error ? error : new Error('Export failed'),
      );
    }
  };

  if (disabled || data.length === 0) {
    return (
      <div
        className={className}
        title={disabled ? 'Export disabled' : 'No data to export'}
        style={{ opacity: 0.5, cursor: 'not-allowed' }}
        {...props}
      >
        {children}
      </div>
    );
  }

  return (
    <UnstyledButton
      className={className}
      title={title}
      onClick={handleClick}
      {...props}
    >
      <CSVDownloader
        data={data}
        filename={filename}
        config={{
          quotes: true,
          quoteChar: '"',
          escapeChar: '"',
          delimiter: ',',
          header: true,
        }}
        style={{
          color: 'inherit',
          textDecoration: 'none',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          display: 'block',
          width: '100%',
          height: '100%',
        }}
      >
        {children}
      </CSVDownloader>
    </UnstyledButton>
  );
};
