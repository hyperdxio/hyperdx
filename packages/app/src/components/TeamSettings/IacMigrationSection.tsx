import { useMemo, useState } from 'react';
import {
  buildImportFile,
  collectImportableResources,
  IAC_MANIFEST_LIMIT,
  type IacImportManifest,
  type IacResourceType,
  providerEndpoint,
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
import { BASE_PATH } from '@/config';
import { downloadTextFile } from '@/utils/downloadFile';

// Keyed by IacResourceType rather than a plain array, so adding a seventh
// provider resource type fails to compile here instead of shipping a type that
// is silently unexportable from Team Settings.
export const RESOURCE_TYPE_OPTIONS: Record<
  IacResourceType,
  {
    label: string;
    // The listing keys only — `truncatedTypes` is metadata, not a resource array.
    key: Exclude<keyof IacImportManifest, 'truncatedTypes'>;
  }
> = {
  dashboard: { label: 'Dashboards', key: 'dashboards' },
  alert: { label: 'Alerts', key: 'alerts' },
  saved_search: { label: 'Saved searches', key: 'savedSearches' },
  source: { label: 'Sources', key: 'sources' },
  connection: { label: 'Connections', key: 'connections' },
  webhook: { label: 'Webhooks', key: 'webhooks' },
};

// Display order. `satisfies` rejects an entry that is not a resource type, but
// nothing in the type system catches the two failures that matter here — a type
// missing from the list, or one listed twice (which would render duplicate
// checkboxes and emit the same import address twice, and Terraform rejects a
// duplicate address for the whole plan). Both are covered by a test that
// compares this against RESOURCE_TYPE_OPTIONS' keys, which is why both are
// exported.
export const RESOURCE_TYPE_ORDER = [
  'dashboard',
  'alert',
  'saved_search',
  'source',
  'connection',
  'webhook',
] as const satisfies readonly IacResourceType[];

const truncatedLabels = (
  truncatedTypes: string[],
  selected: IacResourceType[],
) =>
  RESOURCE_TYPE_ORDER.filter(
    type =>
      selected.includes(type) &&
      truncatedTypes.includes(RESOURCE_TYPE_OPTIONS[type].key),
  ).map(type => RESOURCE_TYPE_OPTIONS[type].label.toLowerCase());

/**
 * Renders the "Export to Terraform" section on the Team Settings page
 * (API & Agents tab). Downloads a Terraform import file for the selected
 * resource types, built entirely client-side from the lean id+name manifest
 * served by `GET /iac/import-manifest`.
 */
export default function IacMigrationSection({
  active = true,
}: {
  /** False while the containing tab is not the visible one — see the hook. */
  active?: boolean;
}) {
  const {
    data: manifest,
    isLoading,
    isError,
    isRefetching,
    refetch,
  } = useIacImportManifest({ enabled: active });
  const [selected, setSelected] = useState<IacResourceType[]>([
    'dashboard',
    'alert',
    'saved_search',
  ]);

  // Banner copy, from the cached manifest. The downloaded file gets its own
  // check off the refetched payload — see onDownload.
  const truncatedSelected = truncatedLabels(
    manifest?.truncatedTypes ?? [],
    selected,
  );

  const {
    resources,
    connectionLocals,
    skippedAlerts,
    skippedDashboards,
    skippedSources,
  } = useMemo(
    () =>
      manifest
        ? collectImportableResources(manifest, selected)
        : {
            resources: [],
            connectionLocals: [],
            skippedAlerts: 0,
            skippedDashboards: 0,
            skippedSources: 0,
          },
    [manifest, selected],
  );
  const [downloadError, setDownloadError] = useState(false);

  const skipNoticesFor = ({
    skippedAlerts: alerts,
    skippedDashboards: dashboards,
    skippedSources: sources,
  }: {
    skippedAlerts: number;
    skippedDashboards: number;
    skippedSources: number;
  }) =>
    [
      {
        count: alerts,
        text: `${alerts} alert${alerts === 1 ? '' : 's'} — the provider only supports saved-search alerts.`,
      },
      {
        count: dashboards,
        text: `${dashboards} dashboard${dashboards === 1 ? '' : 's'} — a tile on them cannot be represented by the provider, and importing one would delete that tile on the next apply.`,
      },
      {
        count: sources,
        text: `${sources} PromQL source${sources === 1 ? '' : 's'} — the provider models only ClickHouse-backed sources.`,
      },
    ]
      .filter(n => n.count > 0)
      .map(n => n.text);

  // One renderer for all three exclusion rules — they differ only in count and
  // reason, and a fourth rule should not mean a fourth near-identical block.
  const skipNotices = [
    {
      key: 'alerts',
      count: skippedAlerts,
      text: `${skippedAlerts} alert${skippedAlerts === 1 ? '' : 's'} will be skipped — the Terraform provider only supports saved-search alerts.`,
    },
    {
      key: 'dashboards',
      count: skippedDashboards,
      text: `${skippedDashboards} dashboard${skippedDashboards === 1 ? '' : 's'} will be skipped — a tile on them cannot be represented by the provider, and importing one would delete that tile on the next apply.`,
    },
    {
      key: 'sources',
      count: skippedSources,
      text: `${skippedSources} PromQL source${skippedSources === 1 ? '' : 's'} will be skipped — the provider models only ClickHouse-backed sources.`,
    },
  ].filter(notice => notice.count > 0);

  const onDownload = async () => {
    // The whole body is guarded: this is an async click handler, so anything
    // that throws past it becomes an unhandled rejection the user never sees —
    // they click Download and nothing happens. buildImportFile in particular
    // throws by design on a non-ObjectId id.
    setDownloadError(false);
    try {
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
          endpoint: providerEndpoint(window.location.origin, BASE_PATH),
          resources: freshSelection.resources,
          connectionLocals: freshSelection.connectionLocals,
          // From the refetched payload, not the banner's cached one: a listing
          // that only became truncated on this refetch would otherwise save a
          // partial file carrying no indication that it is partial.
          truncatedTypes: truncatedLabels(result.data.truncatedTypes, selected),
          // Recomputed from the refetched payload, like truncatedTypes: the
          // banner above is cached-manifest state, the file must describe what
          // was actually written.
          skipNotices: skipNoticesFor(freshSelection),
        }),
        'hyperdx-import.tf',
      );
    } catch (e) {
      console.error('Failed to build the Terraform import file', e);
      setDownloadError(true);
    }
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
          {RESOURCE_TYPE_ORDER.map(type => {
            const opt = RESOURCE_TYPE_OPTIONS[type];
            return (
              <Checkbox
                key={type}
                label={`${opt.label} (${manifest?.[opt.key]?.length ?? 0})`}
                description={
                  type === 'connection'
                    ? 'Exported as reference-only locals — connections are platform-managed on ClickHouse Cloud'
                    : undefined
                }
                checked={selected.includes(type)}
                onChange={e => {
                  const checked = e.currentTarget.checked;
                  setSelected(s =>
                    checked ? [...s, type] : s.filter(t => t !== type),
                  );
                }}
              />
            );
          })}
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
        {/* Surfaced rather than silently dropped: a user who expects 12
            dashboards and gets 10 needs to know why. */}
        {downloadError && (
          <Alert variant="danger" title="Couldn't build the file" mb="sm">
            Something went wrong generating the import file. Nothing was
            downloaded. Reload the page and try again.
          </Alert>
        )}
        {skipNotices.map(({ key, text }) => (
          <Text
            key={key}
            size="xs"
            style={{ color: 'var(--color-text-muted)' }}
            mb="sm"
          >
            {text}
          </Text>
        ))}
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
