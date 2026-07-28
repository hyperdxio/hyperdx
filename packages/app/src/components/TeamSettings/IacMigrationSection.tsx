import { useMemo, useState } from 'react';
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

import {
  buildImportFile,
  collectImportableResources,
  type IacImportManifest,
  type IacResourceType,
} from '@/components/Iac/terraformSnippets';
import { useIacImportManifest } from '@/components/Iac/useIacImportManifest';
import { downloadTextFile } from '@/utils/downloadFile';

const RESOURCE_TYPE_OPTIONS: {
  type: IacResourceType;
  label: string;
  key: keyof IacImportManifest;
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
  const { data: manifest, isLoading, isError } = useIacImportManifest();
  const [selected, setSelected] = useState<IacResourceType[]>([
    'dashboard',
    'alert',
    'saved_search',
  ]);

  const { resources, connectionLocals, skippedTileAlerts } = useMemo(
    () =>
      manifest
        ? collectImportableResources(manifest, selected)
        : { resources: [], connectionLocals: [], skippedTileAlerts: 0 },
    [manifest, selected],
  );

  const onDownload = () => {
    downloadTextFile(
      buildImportFile({
        endpoint: `${window.location.origin}/api`,
        resources,
        connectionLocals,
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
        {skippedTileAlerts > 0 && (
          <Text size="xs" style={{ color: 'var(--color-text-muted)' }} mb="sm">
            {skippedTileAlerts} tile alert{skippedTileAlerts === 1 ? '' : 's'}{' '}
            will be skipped — the Terraform provider only supports saved-search
            alerts.
          </Text>
        )}
        <Button
          variant="primary"
          leftSection={<IconDownload size={16} />}
          onClick={onDownload}
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
