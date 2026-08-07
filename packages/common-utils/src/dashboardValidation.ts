import { z } from 'zod';

import { getFilterVariableName, isFilterVariableEnabled } from './filters';
import { DashboardContainerSchema } from './types';

// Inputs shared by the internal `DashboardSchema` refinement and the
// external API body schema: the validation only depends on the
// containerId/tabId reference shape, not on Builder-vs-RawSql config.
type ContainerForValidation = z.infer<typeof DashboardContainerSchema>;
type TileForValidation = { containerId?: string; tabId?: string };
// Structural for the same reason as the helpers in `./filters`: the internal
// and external filter shapes differ (`source` vs `sourceId`), and only these
// three fields decide variable-name identity.
type FilterForVariableValidation = {
  name: string;
  variableName?: string;
  isVariableEnabled?: boolean;
};

/**
 * Pass 1: container-id uniqueness and per-container tab-id uniqueness.
 *
 * Returns the container-by-id map and a flag indicating whether any
 * duplicate container ids were seen, so callers that intend to do
 * tile-ref resolution next can short-circuit on the duplicate-id case
 * (resolving against a last-write-wins map would mask the duplicate
 * with cascading "unknown containerId" errors).
 *
 * Issues raised:
 * - Duplicate container ids (path `<containersPath>[i].id`).
 * - Duplicate tab ids within a container (path
 *   `<containersPath>[i].tabs[j].id`).
 */
export function validateDashboardContainersStructure(
  containers: ContainerForValidation[],
  ctx: z.RefinementCtx,
  paths?: { containersPath?: (string | number)[] },
): {
  containerById: Map<string, ContainerForValidation>;
  hasDuplicateContainerId: boolean;
} {
  const containersPath = paths?.containersPath ?? ['containers'];

  // The container-by-id map is built INSIDE this pass and is only used
  // by the tile-resolution helper below; building a Map up-front would
  // last-write-win on duplicate ids, masking the duplicate before this
  // loop reports it.
  const containerById = new Map<string, ContainerForValidation>();
  const seenContainerIds = new Set<string>();
  let hasDuplicateContainerId = false;
  containers.forEach((container, containerIdx) => {
    if (seenContainerIds.has(container.id)) {
      hasDuplicateContainerId = true;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Container IDs must be unique: "${container.id}"`,
        path: [...containersPath, containerIdx, 'id'],
      });
    } else {
      seenContainerIds.add(container.id);
      containerById.set(container.id, container);
    }

    if (container.tabs) {
      const seenTabIds = new Set<string>();
      container.tabs.forEach((tab, tabIdx) => {
        if (seenTabIds.has(tab.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate tab id "${tab.id}" in container "${container.id}"`,
            path: [...containersPath, containerIdx, 'tabs', tabIdx, 'id'],
          });
        }
        seenTabIds.add(tab.id);
      });
    }
  });

  return { containerById, hasDuplicateContainerId };
}

/**
 * Pass 2: each tile's containerId resolves to a real container, and
 * each tile's tabId resolves to a tab in that container. Caller is
 * responsible for skipping this pass when container ids aren't unique
 * (the structure helper returns `hasDuplicateContainerId` for that
 * reason).
 *
 * Issues raised:
 * - A tile's `containerId` references an unknown container (path
 *   `<tilesPath>[k].containerId`).
 * - A tile's `tabId` is set without `containerId` (path
 *   `<tilesPath>[k].tabId`).
 * - A tile's `tabId` references an unknown tab (path
 *   `<tilesPath>[k].tabId`).
 */
export function validateDashboardTileContainerRefs<T extends TileForValidation>(
  containerById: Map<string, ContainerForValidation>,
  tiles: T[],
  ctx: z.RefinementCtx,
  paths?: { tilesPath?: (string | number)[] },
): void {
  const tilesPath = paths?.tilesPath ?? ['tiles'];

  tiles.forEach((tile, tileIdx) => {
    if (tile.containerId !== undefined) {
      const container = containerById.get(tile.containerId);
      if (!container) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Tile references unknown containerId "${tile.containerId}"`,
          path: [...tilesPath, tileIdx, 'containerId'],
        });
      }
    }

    if (tile.tabId !== undefined) {
      if (tile.containerId === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'tabId requires containerId to be set',
          path: [...tilesPath, tileIdx, 'tabId'],
        });
        return;
      }
      const container = containerById.get(tile.containerId);
      if (!container) return;
      const tab = container.tabs?.find(t => t.id === tile.tabId);
      if (!tab) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Tile references unknown tabId "${tile.tabId}" in container "${tile.containerId}"`,
          path: [...tilesPath, tileIdx, 'tabId'],
        });
      }
    }
  });
}

/**
 * Variable names across a dashboard's filters must each resolve to something and
 * be unique, mirroring the dashboard filter form's own check so the API cannot
 * accept what the UI refuses (`validateVariableName` in `./filters`).
 *
 * Only filters with variables *enabled* participate, in both directions: a
 * disabled filter is neither reported nor treated as taking a name. That
 * matters because a name is derived from the display name when none is stored,
 * so two legitimately identically-named filters on different sources would
 * otherwise collide for users who never turned the feature on. Deliberately
 * independent of the feature flag itself — the check is on stored data, and
 * data that predates the flag can never trip it.
 *
 * Comparison is case-sensitive, matching the form.
 *
 * Issues raised:
 * - A variable-enabled filter with no name and nothing token-safe to derive one
 *   from (path `<filtersPath>[i].variableName`).
 * - A second variable-enabled filter resolving to an already-taken name
 *   (path `<filtersPath>[i].variableName`).
 */
export function validateDashboardFilterVariableNames(
  filters: FilterForVariableValidation[],
  ctx: z.RefinementCtx,
  paths?: { filtersPath?: (string | number)[] },
): void {
  const filtersPath = paths?.filtersPath ?? ['filters'];
  const seen = new Set<string>();

  filters.forEach((filter, filterIdx) => {
    if (!isFilterVariableEnabled(filter)) return;
    const variableName = getFilterVariableName(filter);

    // No explicit name, and the display name yields nothing token-safe to derive
    // one from. Rejected rather than skipped: the filter is variable-*enabled*, so
    // accepting it would persist a variable with no reference any tile could use —
    // and the form refuses the same state via its own required check.
    if (!variableName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable name is required for filter "${filter.name}"`,
        path: [...filtersPath, filterIdx, 'variableName'],
      });
      return;
    }

    if (seen.has(variableName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variable names must be unique: "${variableName}"`,
        path: [...filtersPath, filterIdx, 'variableName'],
      });
      return;
    }
    seen.add(variableName);
  });
}
