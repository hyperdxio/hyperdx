/**
 * AWS Glue Data Catalog discovery client used by the Berg backend.
 *
 * The pod's IRSA identity is used implicitly — the AWS SDK picks up
 * credentials from the environment / instance metadata.  No credentials
 * appear in code or configuration here.
 *
 * Visibility filtering is implicit via the IAM role: any database / table the
 * role cannot see triggers `AccessDeniedException`, which we silently swallow
 * for browse paths (returning an empty list).  Direct schema fetches surface
 * `AccessDeniedException` and `EntityNotFoundException` to the caller so the
 * UI can show a meaningful error.
 */

import {
  GetDatabasesCommand,
  GetTableCommand,
  GetTablesCommand,
  GlueClient as SdkGlueClient,
  SerDeInfo,
} from '@aws-sdk/client-glue';

import {
  GlueColumn,
  GlueTableFormat,
  GlueTableSchema,
  GlueTableSummary,
} from './types';

export * from './types';

const DEFAULT_CATALOG_ID = 'AwsDataCatalog';

export interface GlueCatalogClientOptions {
  region: string;
}

export class GlueCatalogClient {
  private sdk: SdkGlueClient;

  constructor(opts: GlueCatalogClientOptions) {
    this.sdk = new SdkGlueClient({ region: opts.region });
  }

  /**
   * v1 placeholder: returns the default account-level Glue catalog.
   *
   * Glue exposes catalogs differently depending on account setup (S3 Tables
   * registers as `s3tablescatalog/<bucket>`-style federated catalog ids).
   * Real enumeration is deferred to a follow-up that walks
   * `GetCatalogsCommand`; for now we surface the single default catalog so
   * the rest of the discovery flow has something to anchor to.
   */
  async listCatalogs(): Promise<string[]> {
    return [DEFAULT_CATALOG_ID];
  }

  /**
   * Paginated list of databases / namespaces visible to the IAM role under
   * `catalogId`.  AccessDenied is silently swallowed (returns `[]`) so a
   * partial-permissions role still gets a usable navigation tree.
   */
  async listDatabases(catalogId: string): Promise<string[]> {
    const out: string[] = [];
    let nextToken: string | undefined;
    try {
      do {
        const r = await this.sdk.send(
          new GetDatabasesCommand({
            CatalogId: resolveCatalogId(catalogId),
            NextToken: nextToken,
          }),
        );
        for (const db of r.DatabaseList ?? []) {
          if (db.Name) out.push(db.Name);
        }
        nextToken = r.NextToken;
      } while (nextToken);
      return out;
    } catch (e) {
      if (isAccessDenied(e)) return [];
      throw e;
    }
  }

  /**
   * Paginated list of tables in `database`, with format detection so the UI
   * can render the right icon without a follow-up `GetTable` per row.
   */
  async listTables(
    catalogId: string,
    database: string,
  ): Promise<GlueTableSummary[]> {
    const out: GlueTableSummary[] = [];
    let nextToken: string | undefined;
    try {
      do {
        const r = await this.sdk.send(
          new GetTablesCommand({
            CatalogId: resolveCatalogId(catalogId),
            DatabaseName: database,
            NextToken: nextToken,
          }),
        );
        for (const t of r.TableList ?? []) {
          out.push({
            database,
            table: t.Name ?? '',
            tableType: t.TableType ?? 'unknown',
            format: detectFormat(t.Parameters, t.StorageDescriptor?.SerdeInfo),
          });
        }
        nextToken = r.NextToken;
      } while (nextToken);
      return out;
    } catch (e) {
      if (isAccessDenied(e)) return [];
      throw e;
    }
  }

  /**
   * Fetch full schema for a single table.  Unlike the browse paths, this
   * surfaces `AccessDeniedException` and `EntityNotFoundException` to the
   * caller so the UI can distinguish "not visible" from "no such table" and
   * show a real error rather than a blank schema.
   */
  async getTableSchema(
    catalogId: string,
    database: string,
    table: string,
  ): Promise<GlueTableSchema> {
    const r = await this.sdk.send(
      new GetTableCommand({
        CatalogId: resolveCatalogId(catalogId),
        DatabaseName: database,
        Name: table,
      }),
    );
    if (!r.Table) {
      throw Object.assign(new Error(`Table ${table} not found`), {
        name: 'EntityNotFoundException',
      });
    }

    const t = r.Table;
    const cols: GlueColumn[] = (t.StorageDescriptor?.Columns ?? []).map(c => ({
      name: c.Name ?? '',
      type: c.Type ?? 'varchar',
      ...(c.Comment ? { comment: c.Comment } : {}),
      isPartition: false,
    }));
    const partitionCols: GlueColumn[] = (t.PartitionKeys ?? []).map(c => ({
      name: c.Name ?? '',
      type: c.Type ?? 'varchar',
      ...(c.Comment ? { comment: c.Comment } : {}),
      isPartition: true,
    }));

    return {
      catalogId,
      database,
      table,
      columns: [...cols, ...partitionCols],
      partitionKeys: (t.PartitionKeys ?? []).map(p => p.Name ?? ''),
      format: detectFormat(t.Parameters, t.StorageDescriptor?.SerdeInfo),
      location: t.StorageDescriptor?.Location ?? '',
      tableType: t.TableType ?? 'unknown',
    };
  }
}

/**
 * Glue treats an omitted `CatalogId` as "the default account-level catalog";
 * passing the literal string `AwsDataCatalog` is rejected.  Federated catalog
 * ids (e.g. `s3tablescatalog/my-bucket`) pass through verbatim.
 */
function resolveCatalogId(catalogId: string): string | undefined {
  return catalogId === DEFAULT_CATALOG_ID ? undefined : catalogId;
}

function isAccessDenied(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e as { name?: string }).name === 'AccessDeniedException'
  );
}

function detectFormat(
  params?: Record<string, string>,
  serde?: SerDeInfo,
): GlueTableFormat {
  if (params?.table_type?.toUpperCase() === 'ICEBERG') return 'iceberg';
  const lib = serde?.SerializationLibrary?.toLowerCase() ?? '';
  if (lib.includes('parquet')) return 'parquet';
  if (lib.includes('orc')) return 'orc';
  if (lib.includes('csv') || lib.includes('opencsv')) return 'csv';
  return 'unknown';
}
