import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('sources');
  const mvCount = mvConfigs.length;

  const explanationsByKey = useMemo(
    () => new Map(explanations.map(e => [mvConfigToKey(e.mvConfig), e])),
    [explanations],
  );

  const firstUsedMv = explanations.find(e => e.success)?.mvConfig;

  return (
    <Modal
      title={t('optimization.modalTitle', { count: mvCount })}
      opened={opened}
      onClose={onClose}
      size="lg"
    >
      <div data-testid="mv-optimization-modal">
        <Text size="sm" mb="sm">
          {t('optimization.description', { count: mvCount })}
        </Text>

        <Accordion defaultValue={firstUsedMv && mvConfigToKey(firstUsedMv)}>
          {mvConfigs.map(config => {
            const key = mvConfigToKey(config);
            const explanation = explanationsByKey.get(key);
            const hasErrors = !!explanation?.errors.length;
            const isBeingUsedByOptimizedConfig = explanation?.success;
            const rowEstimate =
              explanation?.rowEstimate?.toLocaleString() ??
              t('optimization.rowEstimateUnknown');

            return (
              <Accordion.Item value={key} key={key}>
                <Accordion.Control
                  px="xs"
                  data-testid="mv-optimization-modal-item"
                  data-mv-table={config.tableName}
                >
                  <Group justify="space-between">
                    <Text>{config.tableName}</Text>
                    {isBeingUsedByOptimizedConfig ? (
                      <Tooltip
                        label={t('optimization.rowEstimate', { rowEstimate })}
                      >
                        <Badge
                          me="md"
                          color={SUCCESS_COLOR}
                          data-testid="mv-optimization-modal-status"
                          data-mv-status="active"
                        >
                          {t('optimization.statusActive')}
                        </Badge>
                      </Tooltip>
                    ) : hasErrors ? (
                      <Tooltip label={t('optimization.incompatibleTooltip')}>
                        <Badge
                          me="md"
                          color={WARNING_COLOR}
                          data-testid="mv-optimization-modal-status"
                          data-mv-status="incompatible"
                        >
                          {t('optimization.statusIncompatible')}
                        </Badge>
                      </Tooltip>
                    ) : explanation ? (
                      <Tooltip
                        label={t('optimization.rowEstimate', { rowEstimate })}
                      >
                        <Badge
                          me="md"
                          color="gray"
                          data-testid="mv-optimization-modal-status"
                          data-mv-status="skipped"
                        >
                          {t('optimization.statusSkipped')}
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
                          {t('optimization.errorsTitle')}
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
      </div>
    </Modal>
  );
}
