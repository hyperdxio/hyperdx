import { useMemo, useState } from 'react';
import { ActionIcon, Popover, Tooltip } from '@mantine/core';
import { IconBrandTerraform } from '@tabler/icons-react';

import {
  TerraformHelperPanel,
  type TerraformSnippet,
} from './TerraformHelperPanel';
import {
  buildImportBlock,
  buildProviderBlock,
  type IacResourceRef,
} from './terraformSnippets';

/**
 * Per-resource "Export to Terraform" affordance: an `import {}` block for
 * one resource, plus a collapsible provider-setup block.
 *
 * Import-only by design. An earlier revision also generated a dashboard's
 * `dashboard_json` from the external v2 API body, on the premise that the body
 * is exactly what the Terraform provider reads. That premise does not hold:
 * `convertToExternalTileChartConfig` is a per-displayType field allowlist, so a
 * tile can survive the conversion while silently losing fields
 * (`alternateRowBackground`, `granularity`, `ratioMode`, and a ratio Number
 * tile's second series). Because `dashboard_json` is a whole-body replace,
 * emitting that body as configuration would write the loss back on apply.
 *
 * `terraform plan -generate-config-out` reads through the provider instead of
 * through us, so importing stays safe and accurate for every resource type.
 * Everything here is derived synchronously from the ref — no fetch.
 *
 * Callers own eligibility: the provider models only saved-search alerts, so an
 * alert call site must not render this for a tile alert.
 */
export default function ResourceTerraformPopover({
  resource,
}: {
  resource: IacResourceRef;
}) {
  const [opened, setOpened] = useState(false);
  // Destructured so the memo keys off primitives. Call sites build `resource`
  // inline in JSX, so depending on the object itself would re-run this on
  // every render.
  const { type, id, name } = resource;

  const snippets = useMemo<TerraformSnippet[]>(() => {
    // Nothing is built until the popover is opened, which can only happen
    // client-side. `buildProviderBlock` reads `window.location.origin`, and
    // this component renders inside a list row on the alerts page — computing
    // it during render would throw under both Next output modes, including the
    // ClickStack static export, where that failure is a build-time crash.
    // The dropdown is unmounted while closed, so there is nothing to show
    // anyway. (`McpServerSection` dodges the same hazard by returning early
    // before it touches `window`.)
    if (!opened) return [];
    return [
      {
        // An `import {}` block, not the CLI `terraform import` one-liner: the
        // CLI form refuses to run unless the resource address is already
        // declared in configuration, and this feature deliberately generates
        // no configuration. The block form is what `-generate-config-out`
        // consumes, so it works in a fresh project — and matches what the
        // bulk export writes, so both surfaces produce the same artefact.
        label: 'Import block',
        hint: 'Add to your Terraform project, then run `terraform plan -generate-config-out=generated.tf` and review before applying. The address is derived from this resource’s current name — if you rename it later, keep the old address or add a `moved` block, or Terraform will manage the object twice.',
        snippet: buildImportBlock({ type, id, name }),
      },
      {
        // Terraform permits one `required_providers` and one default provider
        // config per module, so pasting this a second time is an error, not a
        // convenience. Tucked behind a toggle for the first-time case only.
        label: 'Provider setup',
        collapsible: true,
        hint: 'Add once per Terraform module. Skip if your project already declares the ClickHouse provider.',
        snippet: buildProviderBlock(`${window.location.origin}/api`),
      },
    ];
  }, [opened, type, id, name]);

  return (
    <Popover
      width={520}
      position="bottom-end"
      withArrow
      shadow="md"
      withinPortal
      opened={opened}
      onChange={setOpened}
    >
      <Popover.Target>
        <Tooltip withArrow label="Export to Terraform" fz="xs" color="gray">
          <ActionIcon
            variant="secondary"
            size="input-xs"
            onClick={() => setOpened(o => !o)}
            data-testid={`terraform-popover-button-${id}`}
          >
            <IconBrandTerraform size={14} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <TerraformHelperPanel snippets={snippets} />
      </Popover.Dropdown>
    </Popover>
  );
}
