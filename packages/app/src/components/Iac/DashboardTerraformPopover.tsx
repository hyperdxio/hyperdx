import { useMemo, useState } from 'react';
import { ActionIcon, Popover, Tooltip } from '@mantine/core';
import { IconBrandTerraform } from '@tabler/icons-react';

import {
  TerraformHelperPanel,
  type TerraformSnippet,
} from './TerraformHelperPanel';
import { buildImportCommand, buildProviderBlock } from './terraformSnippets';

/**
 * Import-only by design. An earlier revision also generated the resource's
 * `dashboard_json` from the external v2 API body, on the premise that the body
 * is exactly what the Terraform provider reads. That premise does not hold:
 * `convertToExternalTileChartConfig` is a per-displayType field allowlist, so a
 * tile can survive the conversion while silently losing fields
 * (`alternateRowBackground`, `granularity`, `ratioMode`, and a ratio Number
 * tile's second series). Because `dashboard_json` is a whole-body replace,
 * emitting that body as configuration would write the loss back on apply.
 *
 * `terraform plan -generate-config-out` reads through the provider instead of
 * through us, so importing stays safe and accurate. Everything here is derived
 * synchronously from the id and name — no fetch, nothing to be stale.
 */
export default function DashboardTerraformPopover({
  dashboardId,
  dashboardName,
}: {
  dashboardId: string;
  dashboardName?: string;
}) {
  const [opened, setOpened] = useState(false);

  const snippets = useMemo<TerraformSnippet[]>(
    () => [
      {
        label: 'Import command',
        snippet: buildImportCommand({
          type: 'dashboard',
          id: dashboardId,
          name: dashboardName,
        }),
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
    ],
    [dashboardId, dashboardName],
  );

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
            data-testid="terraform-popover-button"
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
