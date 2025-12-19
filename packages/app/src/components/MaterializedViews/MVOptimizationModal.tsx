import { useMemo } from 'react';
import { MVOptimizationExplanation } from '@hyperdx/common-utils/dist/core/materializedViews';
import { MaterializedViewConfiguration } from '@hyperdx/common-utils/dist/types';
import {
  Accordion,
  Alert,
  Badge,
  Group,
  Modal,
  Text,
  Tooltip,
} from '@mantine/core';

import MVConfigSummary from './MVConfigSummary';

const WARNING_COLOR = 'var(--color-bg-warning)';
const SUCCESS_COLOR = 'var(--color-bg-success)';

function mvConfigToKey(config: MaterializedViewConfiguration) {
  return `mv-${config.databaseName}-${config.tableName}`;
}

export default function MVOptimizationModal({
  mvConfigs,
  explanations,
  opened,
  onClose,
}: {
  mvConfigs: MaterializedViewConfiguration[];
  explanations: MVOptimizationExplanation[];
  opened: boolean;
  onClose: () => void;
}) {
  const hasMultipleMVs = mvConfigs.length > 1;

  const explanationsByKey = useMemo(
    () => new Map(explanations.map(e => [mvConfigToKey(e.mvConfig), e])),
    [explanations],
  );

  const firstUsedMv = explanations.find(e => e.success)?.mvConfig;

  return (
    <Modal
      title={
        <Group>
          {hasMultipleMVs ? 'Materialized Views' : 'Materialized View'}
          <Badge size="sm" radius="sm" color="gray">
            Beta
          </Badge>
        </Group>
      }
      opened={opened}
      onClose={onClose}
      size="lg"
    >
      <Text size="sm" mb="sm">
        This source is configured with{' '}
        {hasMultipleMVs ? 'materialized views' : 'a materialized view'} for
        accelerating some aggregations.
      </Text>

      <Accordion defaultValue={firstUsedMv && mvConfigToKey(firstUsedMv)}>
        {mvConfigs.map(config => {
          const key = mvConfigToKey(config);
          const explanation = explanationsByKey.get(key);
          const hasErrors = !!explanation?.errors.length;
          const isBeingUsedByOptimizedConfig = explanation?.success;
          const rowEstimate =
            explanation?.rowEstimate?.toLocaleString() ?? 'N/A';

          return (
            <Accordion.Item value={key} key={key}>
              <Accordion.Control px="xs">
                <Group justify="space-between">
                  <Text>{config.tableName}</Text>
                  {isBeingUsedByOptimizedConfig ? (
                    <Tooltip label={`Estimated rows scanned: ${rowEstimate}`}>
                      <Badge me="md" color={SUCCESS_COLOR}>
                        Active
                      </Badge>
                    </Tooltip>
                  ) : hasErrors ? (
                    <Tooltip label="This materialized view is not compatible with the selected query.">
                      <Badge me="md" color={WARNING_COLOR}>
                        Incompatible
                      </Badge>
                    </Tooltip>
                  ) : explanation ? (
                    <Tooltip label={`Estimated rows scanned: ${rowEstimate}`}>
                      <Badge me="md" color="gray">
                        Skipped
                      </Badge>
                    </Tooltip>
                  ) : null}
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <>
                  <MVConfigSummary config={config} />
                  {hasErrors && (
                    <Alert color="red" mt="xs">
                      <Text size="sm" fw={500} mb="xs">
                        The query cannot be accelerated using this materialized
                        view for the following reason(s):
                      </Text>
                      {explanation.errors.map((error, idx) => (
                        <Text size="sm" key={idx} mt="xs">
                          {error}
                        </Text>
                      ))}
                    </Alert>
                  )}
                </>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>
    </Modal>
  );
}
