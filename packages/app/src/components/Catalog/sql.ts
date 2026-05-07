/**
 * SQL helpers used by the Catalog tabs.
 *
 * Why these exist: the Glue Data Catalog API and Athena's SQL parser
 * disagree on how a federated S3 Tables catalog is named.
 *
 * - Glue API (e.g. `GetDatabases`, `GetTables`) accepts the catalog ID
 *   in its full Glue form: `<account>:s3tablescatalog/<bucket>` for a
 *   cross-account or account-prefixed federated catalog.
 *
 * - Athena's SQL parser, however, won't accept that colon-prefixed form
 *   inside a quoted identifier — `SELECT * FROM "<account>:s3tablescatalog/..."`
 *   throws `InvalidRequestException: Invalid catalog specified ...`.
 *   Athena's catalog identifier (the data-source name registered with
 *   the workgroup) is the part *after* the colon: `s3tablescatalog/<bucket>`.
 *
 * `toAthenaCatalogName` strips the optional `<account>:` prefix so the
 * same Glue catalog ID we use for browse can be embedded in SQL.
 */

export function toAthenaCatalogName(catalogId: string): string {
  const idx = catalogId.indexOf(':');
  return idx > 0 ? catalogId.slice(idx + 1) : catalogId;
}

export function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

export function fullyQualifiedTable(
  catalogId: string,
  database: string,
  table: string,
): string {
  return `${quoteIdent(toAthenaCatalogName(catalogId))}.${quoteIdent(database)}.${quoteIdent(table)}`;
}
