import { useMemo } from 'react';
import {
  buildImportBlock,
  buildProviderBlock,
  type IacResourceRef,
  providerEndpoint,
  TERRAFORM_PROVIDER_TILE_ALERT_VERSION_CONSTRAINT,
} from '@hyperdx/common-utils/dist/iac';

import api from '@/api';
import { BASE_PATH } from '@/config';

import type { TerraformSnippet } from './TerraformHelperPanel';

/**
 * Terraform `import {}` block for one resource, plus a collapsible
 * provider-setup block. Shared by the popover affordance and the alerts-page
 * row menu, which surface the same snippets through different chrome.
 *
 * `enabled` is the caller's open state, and it gates the whole build: the
 * provider block needs `window.location.origin`, so computing it during
 * render would throw under both Next output modes, including the ClickStack
 * static export where that failure is a build-time crash. Nothing is built
 * until the user opens the surface, which can only happen client-side.
 */
export function useTerraformSnippets({
  resource,
  enabled,
}: {
  resource: IacResourceRef;
  enabled: boolean;
}): TerraformSnippet[] {
  // Destructured so the memo keys off primitives. Call sites build `resource`
  // inline in JSX, so depending on the object itself would re-run this on
  // every render.
  const { type, id, name, tileAlert } = resource;
  // Import ids are team-scoped. Read here rather than taken as a prop so the
  // call sites don't each have to know that. `me` is fetched once for the app
  // shell, so this is a cache read; it is only null in local mode, where
  // IS_IAC_EXPORT_ENABLED is false and no caller renders.
  const teamId = api.useMe().data?.team.id;

  return useMemo<TerraformSnippet[]>(() => {
    if (!enabled || !teamId) return [];
    return [
      {
        // An `import {}` block, not the CLI `terraform import` one-liner: the
        // CLI form refuses to run unless the resource address is already
        // declared in configuration, and this feature deliberately generates
        // no configuration. The block form is what `-generate-config-out`
        // consumes, so it works in a fresh project — and matches what the
        // bulk export writes, so both surfaces produce the same artefact.
        label: 'Import block',
        // The tile-alert caveat is the bulk file's, cut to one line. This is
        // the likelier path for someone who just made a tile alert, and the
        // generated config it produces is only durable after a hand edit.
        hint: `Add to your Terraform project, then run \`terraform plan -generate-config-out=generated.tf\` and review before applying. The address is derived from this resource’s id, so it survives a rename in HyperDX.${
          tileAlert
            ? ' The generated config pins dashboard_id and tile_id as literals — replace them with clickhouse_clickstack_dashboard references before you apply, or a later dashboard apply re-mints the tile id and deletes this alert with the tile it pointed at.'
            : ''
        }`,
        snippet: buildImportBlock({ type, id, name }, teamId),
      },
      {
        // Terraform permits one `required_providers` and one default provider
        // config per module, so pasting this a second time is an error, not a
        // convenience. Tucked behind a toggle for the first-time case only.
        label: 'Provider setup',
        collapsible: true,
        hint: `Add once per Terraform module. Skip if your project already declares the ClickHouse provider${
          tileAlert
            ? `, as long as it requires ${TERRAFORM_PROVIDER_TILE_ALERT_VERSION_CONSTRAINT} — earlier versions cannot model a tile alert`
            : ''
        }.`,
        // A tile alert needs the provider version that models
        // `source = "tile"`, so the floor here follows the resource.
        snippet: buildProviderBlock(
          providerEndpoint(window.location.origin, BASE_PATH),
          { tileAlerts: !!tileAlert },
        ),
      },
    ];
  }, [enabled, type, id, name, tileAlert, teamId]);
}
