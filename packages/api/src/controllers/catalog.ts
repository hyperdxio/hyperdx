/**
 * Glue Data Catalog browse controller.
 *
 * The underlying `GlueCatalogClient` already silently filters
 * `AccessDeniedException` for browse paths (returns `[]`) and surfaces it
 * along with `EntityNotFoundException` for direct schema fetches; we keep
 * the controller surface a thin pass-through so the router can map those
 * surfaced errors to HTTP statuses.
 */

import { GlueCatalogClient } from '@berg/common-utils/dist/glue';

import * as cfg from '@/config';

const glue = new GlueCatalogClient({ region: cfg.ATHENA_REGION });

/**
 * Returns the catalog the deployment is scoped to (`GLUE_CATALOG_ID` env).
 * Falls back to the SDK's default account-level catalog if unset.
 */
export const listCatalogs = async (): Promise<string[]> => {
  return [cfg.GLUE_CATALOG_ID];
};

/**
 * Lists databases under `catalogId`, additionally filtered by the
 * `GLUE_DATABASES` allowlist when configured.  An empty allowlist means
 * "show whatever the IAM role can see".
 */
export const listDatabases = async (catalogId: string): Promise<string[]> => {
  const all = await glue.listDatabases(catalogId);
  if (cfg.GLUE_DATABASES.length === 0) return all;
  const allowed = new Set(cfg.GLUE_DATABASES);
  return all.filter(name => allowed.has(name));
};

export const listTables = (catalogId: string, database: string) =>
  glue.listTables(catalogId, database);

export const getTableSchema = (
  catalogId: string,
  database: string,
  table: string,
) => glue.getTableSchema(catalogId, database, table);
