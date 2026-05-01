import { useMemo } from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Badge,
  Box,
  Divider,
  Group,
  Loader,
  Stack,
  Text,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';

import { rateOptimizationLevel } from '@/optimizations/performanceReview';
import { useOptimizationOpportunities } from '@/optimizations/useOptimizations';
import { useSources } from '@/source';

import MaterializedColumnsSection from './MaterializedColumns/MaterializedColumnsSection';
import OptimizationGroup, { GroupItem } from './OptimizationGroup';

const GRADE_COLOR: Record<string, string> = {
  Overachieving: 'green',
  Satisfactory: 'yellow',
  'Needs Improvement': 'red',
};

type Bucket = {
  source?: TSource;
  active: GroupItem[];
  dismissed: GroupItem[];
};

export default function OptimizationsSection() {
  const { data: sources } = useSources();
  const { results, isLoading, totalActive } = useOptimizationOpportunities();

  const review = useMemo(
    () => rateOptimizationLevel(sources ?? [], results),
    [sources, results],
  );

  // Group findings (active + dismissed) by source so the user sees all
  // optimizations for a given table together rather than scattered by
  // recommendation type.
  const { buckets, generalBucket, errors } = useMemo(() => {
    const sourceList = sources ?? [];
    const _buckets = new Map<string, Bucket>();
    const _general: Bucket = { active: [], dismissed: [] };
    const _errors: Array<{ pluginTitle: string; error: Error }> = [];

    const bucketFor = (source: TSource | undefined): Bucket => {
      if (!source) return _general;
      let b = _buckets.get(source.id);
      if (!b) {
        b = { source, active: [], dismissed: [] };
        _buckets.set(source.id, b);
      }
      return b;
    };

    for (const result of results) {
      if (result.error) {
        _errors.push({
          pluginTitle: result.plugin.title,
          error: result.error,
        });
      }
      for (const finding of result.activeFindings) {
        const source = result.plugin.resolveSource?.(finding, sourceList);
        bucketFor(source).active.push({ plugin: result.plugin, finding });
      }
      for (const finding of result.dismissedFindings) {
        const source = result.plugin.resolveSource?.(finding, sourceList);
        bucketFor(source).dismissed.push({ plugin: result.plugin, finding });
      }
    }

    // Stable order: sources alphabetical by name; general bucket last.
    const ordered = Array.from(_buckets.values()).sort((a, b) =>
      (a.source?.name ?? '').localeCompare(b.source?.name ?? ''),
    );

    return { buckets: ordered, generalBucket: _general, errors: _errors };
  }, [results, sources]);

  const hasAnyFindings =
    buckets.length > 0 ||
    generalBucket.active.length > 0 ||
    generalBucket.dismissed.length > 0;

  return (
    <Box id="optimization" data-testid="optimization-section">
      <Stack gap="xl">
        <Box>
          <Group gap="sm" align="center" mb="xs">
            <Text size="md" fw={600}>
              Performance review
            </Text>
            {isLoading ? (
              <Loader size="xs" />
            ) : (
              <Badge color={GRADE_COLOR[review.grade]} variant="light">
                {review.grade}
              </Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed">
            Review your overall schema-optimization posture and apply
            recommendations to keep HyperDX queries fast.
          </Text>
        </Box>

        <Box>
          <Group gap="xs" align="center">
            <Text size="md">Source schema optimizations</Text>
            {isLoading && <Loader size="xs" />}
            {!isLoading && totalActive === 0 && (
              <Group gap={4} c="dimmed">
                <IconCheck size={14} />
                <Text size="xs">All clear</Text>
              </Group>
            )}
          </Group>
          <Divider my="md" />
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              View and apply optimizations to your source schemas to improve
              query performance.
            </Text>

            {errors.map(({ pluginTitle, error }) => (
              <Alert
                key={pluginTitle}
                color="red"
                icon={<IconAlertTriangle size={16} />}
                title={`Detection error: ${pluginTitle}`}
              >
                {error.message}
              </Alert>
            ))}

            {!isLoading && !hasAnyFindings && errors.length === 0 && (
              <Alert color="gray" icon={<IconCheck size={16} />}>
                No schema optimizations detected for any source.
              </Alert>
            )}

            {buckets.map(bucket =>
              bucket.source ? (
                <OptimizationGroup
                  key={bucket.source.id}
                  title={bucket.source.name}
                  subtitle={`${bucket.source.from.databaseName}.${bucket.source.from.tableName}`}
                  kindLabel={bucket.source.kind}
                  source={bucket.source}
                  active={bucket.active}
                  dismissed={bucket.dismissed}
                />
              ) : null,
            )}

            {(generalBucket.active.length > 0 ||
              generalBucket.dismissed.length > 0) && (
              <OptimizationGroup
                title="Other recommendations"
                subtitle="Server-wide / not tied to a specific source"
                active={generalBucket.active}
                dismissed={generalBucket.dismissed}
              />
            )}
          </Stack>
        </Box>

        <MaterializedColumnsSection />
      </Stack>
    </Box>
  );
}
