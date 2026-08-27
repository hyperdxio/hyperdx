import { useState } from 'react';
import { type IacResourceRef } from '@hyperdx/common-utils/dist/iac';
import { ActionIcon, Popover, Tooltip } from '@mantine/core';
import { IconBrandTerraform } from '@tabler/icons-react';

import { IS_IAC_EXPORT_ENABLED } from '@/config';

import { TerraformHelperPanel } from './TerraformHelperPanel';
import { useTerraformSnippets } from './useTerraformSnippets';

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
 * Feature and local-mode gating lives here rather than at each call site, so
 * the surfaces that render this cannot drift on when it appears. Callers
 * still own per-resource eligibility: the provider models only saved-search
 * alerts, so an alert call site must not render this for a tile alert.
 */
export default function ResourceTerraformPopover({
  resource,
}: {
  resource: IacResourceRef;
}) {
  const [opened, setOpened] = useState(false);
  const { id } = resource;
  const snippets = useTerraformSnippets({ resource, enabled: opened });

  // After the hooks, so the early return cannot change hook order.
  if (!IS_IAC_EXPORT_ENABLED) return null;

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
