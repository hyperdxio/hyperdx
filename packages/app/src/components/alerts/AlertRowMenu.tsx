import * as React from 'react';
import Link from 'next/link';
import { isImportableAlert } from '@hyperdx/common-utils/dist/iac';
import { ActionIcon, Menu, Modal } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconBrandTerraform,
  IconDots,
  IconExternalLink,
  IconTrash,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';

import api from '@/api';
import { TerraformHelperPanel } from '@/components/Iac/TerraformHelperPanel';
import { useTerraformSnippets } from '@/components/Iac/useTerraformSnippets';
import { IS_IAC_EXPORT_ENABLED } from '@/config';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import type { AlertsPageItem } from '@/types';
import { useConfirm } from '@/useConfirm';

type AlertRowMenuProps = {
  alert: AlertsPageItem;
  /** Link to the alert's source (saved search or dashboard tile). */
  alertUrl?: string;
  /** Label for that source, e.g. "Saved search". */
  linkTitle?: string;
  /**
   * Display name, for the delete confirmation and the menu's accessible
   * label. Both `getAlertDisplayName` and `linkTitle` return an empty string
   * for an alert whose source can't be resolved, so callers may pass one.
   */
  alertName?: string;
};

/**
 * Overflow menu for one alerts-page row.
 *
 * It renders unconditionally, which is the point: the actions it holds are
 * each conditional (Terraform import needs an importable alert *and* the
 * export feature, the source link needs a resolvable url), and when they
 * lived directly in the row those gaps collapsed the flex layout so no two
 * rows lined up. Collecting them behind one always-present control gives
 * every row the same trailing slot.
 */
export function AlertRowMenu({
  alert,
  alertUrl,
  linkTitle,
  alertName,
}: AlertRowMenuProps) {
  // `||`, not `??`: the empty string these arrive as for an unresolvable
  // source is not nullish, and would read as "Open " and "Delete ?".
  const name = alertName?.trim() || 'this alert';
  const sourceLabel = linkTitle?.trim().toLowerCase() || 'source';
  const [terraformOpened, setTerraformOpened] = React.useState(false);
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const brandName = useBrandDisplayName();
  const deleteAlert = api.useDeleteAlert();

  const resource = React.useMemo(
    () => ({
      type: 'alert' as const,
      id: alert._id,
      // No fallback to the saved search's name: the name only labels the
      // generated block, and the manifest the bulk export reads carries the
      // alert's own name, so a fallback here would make the two surfaces
      // disagree about what they call this alert.
      name: alert.name ?? undefined,
    }),
    [alert._id, alert.name],
  );
  const snippets = useTerraformSnippets({
    resource,
    enabled: terraformOpened,
  });

  // Eligibility comes from the shared predicate rather than an inline source
  // check, so this and the bulk export can't diverge on which alerts the
  // provider can actually model. The feature flag is checked here too because
  // this renders the panel directly rather than through the popover, which
  // does its own gating.
  const canExport = IS_IAC_EXPORT_ENABLED && isImportableAlert(alert);

  const onDelete = React.useCallback(async () => {
    const confirmed = await confirm(`Delete ${name}?`, 'Delete', {
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    try {
      await deleteAlert.mutateAsync(alert._id);
      notifications.show({
        color: 'green',
        message: 'Alert deleted!',
        autoClose: 5000,
      });
      // The alerts list and the source-bound edit surfaces (saved search
      // modal / dashboard tile editor) all render this alert.
      queryClient.invalidateQueries({ queryKey: api.getAlertsQueryKey() });
      queryClient.invalidateQueries({ queryKey: ['saved-search'] });
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    } catch (error) {
      console.error('Failed to delete alert:', error);
      notifications.show({
        color: 'red',
        message: `Something went wrong. Please contact ${brandName} team.`,
        autoClose: 5000,
      });
    }
  }, [alert._id, brandName, confirm, deleteAlert, name, queryClient]);

  return (
    <>
      <Menu withArrow position="bottom-end">
        <Menu.Target>
          <ActionIcon
            variant="secondary"
            size="input-xs"
            aria-label={`Actions for ${name}`}
            data-testid={`alert-row-menu-${alert._id}`}
          >
            <IconDots size={14} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {alertUrl && (
            <Menu.Item
              component={Link}
              href={alertUrl}
              leftSection={<IconExternalLink size={16} />}
            >
              Open {sourceLabel}
            </Menu.Item>
          )}
          {canExport && (
            <Menu.Item
              leftSection={<IconBrandTerraform size={16} />}
              onClick={() => setTerraformOpened(true)}
              data-testid={`terraform-menu-item-${alert._id}`}
            >
              Export to Terraform
            </Menu.Item>
          )}
          <Menu.Item
            color="red"
            leftSection={<IconTrash size={16} />}
            onClick={onDelete}
            data-testid={`alert-delete-${alert._id}`}
          >
            Delete alert
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      {/* Outside the dropdown, which unmounts on close. */}
      <Modal
        opened={terraformOpened}
        onClose={() => setTerraformOpened(false)}
        title="Export to Terraform"
        size="lg"
      >
        <TerraformHelperPanel snippets={snippets} />
      </Modal>
    </>
  );
}
