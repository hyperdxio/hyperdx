import { useState } from 'react';
import { Filter, TMetricSource } from '@hyperdx/common-utils/dist/types';
import { Button, Group, Text } from '@mantine/core';

import { METRIC_QUANTITY_LABELS } from './classifyMetric';
import { MetricTile } from './MetricTile';
import { MetricFilterClause } from './tileDefaults';
import { WallBand, WallItem, WallSection } from './wallGrouping';

import styles from './MetricWall.module.scss';

const INITIAL_SECTIONS = 10;

function bandTitle(band: WallBand): string {
  return band.quantity === 'all'
    ? 'All metrics'
    : METRIC_QUANTITY_LABELS[band.quantity];
}

function sectionTitle(section: WallSection): {
  title: string;
  subtitle?: string;
} {
  if (section.entity) {
    return { title: section.entity.value, subtitle: section.entity.key };
  }
  return section.id === 'unscoped'
    ? { title: 'Other', subtitle: 'no service.name or host.name' }
    : { title: 'All metrics' };
}

export function MetricWall({
  sections,
  source,
  dateRange,
  filters,
  searchFilters,
  expandedKey,
  onOpen,
  renderDrillDown,
}: {
  sections: WallSection[];
  source: TMetricSource;
  dateRange: [Date, Date];
  filters: MetricFilterClause[];
  searchFilters: Filter[];
  expandedKey?: string;
  onOpen: (item: WallItem) => void;
  renderDrillDown: (item: WallItem) => React.ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? sections : sections.slice(0, INITIAL_SECTIONS);

  return (
    <>
      {visible.map(section => {
        const { title, subtitle } = sectionTitle(section);
        return (
          <section
            key={section.id}
            className={styles.section}
            data-testid="metric-wall-section"
          >
            <Group justify="space-between" mb={4}>
              <Group gap="xs" align="baseline">
                <Text fw={600} size="sm">
                  {title}
                </Text>
                {subtitle && (
                  <Text size="xs" c="dimmed" ff="monospace">
                    {subtitle}
                  </Text>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {section.metricCount} metric
                {section.metricCount === 1 ? '' : 's'}
              </Text>
            </Group>
            {section.bands.map(band => {
              const expanded = band.items.find(i => i.key === expandedKey);
              return (
                <div key={band.quantity}>
                  <div className={styles.bandHeader}>
                    <Text
                      fz={11}
                      fw={600}
                      tt="uppercase"
                      c={band.quantity === 'unclassified' ? 'red' : undefined}
                    >
                      {bandTitle(band)} · {band.items.length}
                    </Text>
                    {band.quantity === 'unclassified' && (
                      <Text fz={10} c="dimmed">
                        No declared unit, name did not parse
                      </Text>
                    )}
                  </div>
                  {expanded && renderDrillDown(expanded)}
                  <div className={styles.grid}>
                    {band.items.map(item => (
                      <MetricTile
                        key={item.key}
                        item={item}
                        source={source}
                        dateRange={dateRange}
                        filters={filters}
                        searchFilters={searchFilters}
                        onOpen={onOpen}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
      {sections.length > INITIAL_SECTIONS && (
        <Button
          variant="secondary"
          size="xs"
          onClick={() => setShowAll(v => !v)}
        >
          {showAll
            ? 'Show fewer'
            : `Show ${sections.length - INITIAL_SECTIONS} more`}
        </Button>
      )}
    </>
  );
}
