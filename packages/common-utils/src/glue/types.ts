/**
 * Type definitions for the AWS Glue Data Catalog discovery client.
 *
 * Format strings are normalised to a small closed set so the UI can pick the
 * right icon / metadata view without re-parsing Glue's serde data.
 */

export interface GlueColumn {
  name: string;
  type: string; // raw Trino type as Glue reports it
  comment?: string;
  isPartition: boolean;
}

export type GlueTableFormat = 'iceberg' | 'parquet' | 'orc' | 'csv' | 'unknown';

export interface GlueTableSchema {
  catalogId: string;
  database: string;
  table: string;
  columns: GlueColumn[];
  partitionKeys: string[];
  format: GlueTableFormat;
  location: string;
  tableType:
    | 'EXTERNAL_TABLE'
    | 'VIRTUAL_VIEW'
    | 'MANAGED_TABLE'
    | 'GOVERNED'
    | string;
}

export interface GlueTableSummary {
  database: string;
  table: string;
  format: GlueTableFormat;
  tableType: string;
}
