import { useMemo, useState } from 'react';
import {
  buildImportFile,
  collectImportableResources,
  IAC_MANIFEST_LIMIT,
  type IacImportManifest,
  type IacResourceType,
} from '@hyperdx/common-utils/dist/iac';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Stack,
  Text,
} from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';

import { useIacImportManifest } from '@/components/Iac/useIacImportManifest';
import { downloadTextFile } from '@/utils/downloadFile';

const RESOURCE_TYPE_OPTIONS: {
  type: IacResourceType;
  label: string;
  // The listing keys only — `truncatedTypes` is metadata, not a resource array.
  key: Exclude<keyof IacImportManifest, 'truncatedTypes'>;
}[] = [
  { type: 'dashboard', label: 'Dashboards', key: 'dashboards' },
  { type: 'alert', label: 'Alerts', key: 'alerts' },
  { type: 'saved_search', label: 'Saved searches', key: 'savedSearches' },
  { type: 'source', label: 'Sources', key: 'sources' },
  { type: 'connection', label: 'Connections', key: 'connections' },
  { type: 'webhook', label: 'Webhooks', key: 'webhooks' },
];

/**
 * Renders the "Export to Terraform" section on the Team Settings page
 * (API & Agents tab). Downloads a Terraform import file for the selected
 * resource types, built entirely client-side from the lean id+name manifest
 * served by `GET /iac/import-manifest`.
 */
export default function IacMigrationSection() {
  const {
    data: manifest,
    isLoading,
    isError,
    isRefetching,
    refetch,
  } = useIacImportManifest();
  const [selected, setSelected] = useState<IacResourceType[]>([
    'dashboard',
    'alert',
    'saved_search',
  ]);

  // Labels of the ticked types whose listing the server capped.
  const truncatedSelected = RESOURCE_TYPE_OPTIONS.filter(
    opt =>
      selected.includes(opt.type) && manifest?.truncatedTypes.includes(opt.key),
  ).map(opt => opt.label.toLowerCase());

  const { resources, connectionLocals, skippedAlerts } = useMemo(
    () =>
      manifest
        ? collectImportableResources(manifest, selected)
        : { resources: [], connectionLocals: [], skippedAlerts: 0 },
    [manifest, selected],
  );

  const onDownload = async () => {
    // Built from a refetch, not from the 60s-stale cache. A resource deleted
    // inside that window would be written out as a dangling id, and
    // `terraform plan -generate-config-out` then fails for every block in the
    // file, not just the stale one.
    //
    // Branches on isSuccess, not on `data`: once the query has succeeded once,
    // a failed refetch resolves with the PREVIOUS payload still in `data`, so
    // a truthiness check would write exactly the stale file this refetch
    // exists to avoid. The failure surfaces through the isError banner below.
    const result = await refetch();
    if (!result.isSuccess || !result.data) return;
    const freshSelection = collectImportableResources(result.data, selected);

    downloadTextFile(
      buildImportFile({
        endpoint: `${window.location.origin}/api`,
        resources: freshSelection.resources,
        connectionLocals: freshSelection.connectionLocals,
      }),
      'hyperdx-import.tf',
    );
  };

  return (
    <Box id="iac_migration" data-testid="iac-migration-section">
      <Group gap="xs">
        <Text size="md">Export to Terraform</Text>
        <Badge variant="light" fw="normal" size="xs">
          Experimental
        </Badge>
      </Group>
      <Divider my="md" />
      <Card>
        <Text size="sm" style={{ color: 'var(--color-text-muted)' }} mb="md">
          Download a Terraform import file for this team&apos;s resources. Add
          it to your Terraform project, then run{' '}
          <Text span ff="monospace" size="xs">
            terraform plan -generate-config-out=generated.tf
          </Text>{' '}
          to generate resource configuration using the ClickHouse provider.
        </Text>
        <Stack gap="xs" mb="md">
          {RESOURCE_TYPE_OPTIONS.map(opt => (
            <Checkbox
              key={opt.type}
              label={`${opt.label} (${manifest?.[opt.key]?.length ?? 0})`}
              description={
                opt.type === 'connection'
                  ? 'Exported as reference-only locals — connections are platform-managed on ClickHouse Cloud'
                  : undefined
              }
              checked={selected.includes(opt.type)}
              onChange={e => {
                const checked = e.currentTarget.checked;
                setSelected(s =>
                  checked ? [...s, opt.type] : s.filter(t => t !== opt.type),
                );
              }}
            />
          ))}
        </Stack>
        {/* Without this, a failed fetch is indistinguishable from a team that
            genuinely has nothing to export — every count reads "(0)". */}
        {isError && (
          <Alert variant="danger" title="Couldn't load resources" mb="sm">
            The list of exportable resources failed to load, so the counts above
            are not accurate. Reload the page to try again.
          </Alert>
        )}
        {/* The endpoint caps each listing, so a very large team gets a partial
            file. Only warn about types the user actually ticked — a capped
            listing they did not select does not affect their download. The
            copy deliberately does not offer a way to get the rest: the
            manifest has no paging, so a second export returns the same page.
            */}
        {truncatedSelected.length > 0 && (
          <Alert variant="warning" title="Not everything is listed" mb="sm">
            This team has more than {IAC_MANIFEST_LIMIT.toLocaleString()} of
            each of: {truncatedSelected.join(', ')}. Only the first{' '}
            {IAC_MANIFEST_LIMIT.toLocaleString()} of each are in this file.
          </Alert>
        )}
        {skippedAlerts > 0 && (
          <Text size="xs" style={{ color: 'var(--color-text-muted)' }} mb="sm">
            {skippedAlerts} alert{skippedAlerts === 1 ? '' : 's'} will be
            skipped — the Terraform provider only supports saved-search alerts.
          </Text>
        )}
        <Button
          variant="primary"
          leftSection={<IconDownload size={16} />}
          onClick={onDownload}
          loading={isRefetching}
          disabled={
            isLoading ||
            isError ||
            (resources.length === 0 && connectionLocals.length === 0)
          }
          data-testid="iac-download-button"
        >
          Download import file
        </Button>
      </Card>
    </Box>
  );
}
