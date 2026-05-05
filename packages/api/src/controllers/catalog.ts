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

export const listCatalogs = () => glue.listCatalogs();

export const listDatabases = (catalogId: string) =>
  glue.listDatabases(catalogId);

export const listTables = (catalogId: string, database: string) =>
  glue.listTables(catalogId, database);

export const getTableSchema = (
  catalogId: string,
  database: string,
  table: string,
) => glue.getTableSchema(catalogId, database, table);
