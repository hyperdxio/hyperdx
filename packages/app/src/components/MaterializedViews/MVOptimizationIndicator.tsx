import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BuilderChartConfigWithOptDateRange,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { ActionIcon, Badge, Tooltip } from '@mantine/core';
import { IconBolt, IconBoltOff } from '@tabler/icons-react';

import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';

import MVOptimizationModal from './MVOptimizationModal';

const WARNING_COLOR = 'var(--color-bg-warning)';
const SUCCESS_COLOR = 'var(--color-bg-success)';

function MVOptimizationIcon({
  isInWarningState,
  onClick,
}: {
  isInWarningState: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation('sources');

  return isInWarningState ? (
    <Tooltip label={t('optimization.notAccelerated')}>
      <ActionIcon
        onClick={onClick}
        aria-label={t('optimization.notAccelerated')}
        data-testid="mv-optimization-indicator"
        data-mv-accelerated="false"
      >
        <IconBoltOff size={16} color={WARNING_COLOR} />
      </ActionIcon>
    </Tooltip>
  ) : (
    <Tooltip label={t('optimization.accelerated')}>
      <ActionIcon
        onClick={onClick}
        aria-label={t('optimization.accelerated')}
        data-testid="mv-optimization-indicator"
        data-mv-accelerated="true"
      >
        <IconBolt size={18} color={SUCCESS_COLOR} />
      </ActionIcon>
    </Tooltip>
  );
}

function MVOptimizationBadge({
  isInWarningState,
  onClick,
}: {
  isInWarningState: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation('sources');

  return (
    <Badge
      color={isInWarningState ? WARNING_COLOR : SUCCESS_COLOR}
      onClick={onClick}
      className="cursor-pointer"
      data-testid="mv-optimization-indicator"
      data-mv-accelerated={isInWarningState ? 'false' : 'true'}
    >
      {isInWarningState
        ? t('optimization.notAccelerated')
        : t('optimization.accelerated')}
    </Badge>
  );
}

export default function MVOptimizationIndicator({
  source,
  config,
  variant = 'badge',
}: {
  source: TSource;
  config: BuilderChartConfigWithOptDateRange | undefined;
  variant?: 'badge' | 'icon';
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const { data } = useMVOptimizationExplanation(config);

  const mvConfigs =
    ((source.kind === SourceKind.Log || source.kind === SourceKind.Trace) &&
      source.materializedViews) ||
    [];
  if (!mvConfigs?.length) {
    return null;
  }

  const isInWarningState = !!config && !!data && !data?.optimizedConfig;

  return (
    <>
      {variant === 'icon' ? (
        <MVOptimizationIcon
          isInWarningState={isInWarningState}
          onClick={() => setModalOpen(true)}
        />
      ) : (
        <MVOptimizationBadge
          isInWarningState={isInWarningState}
          onClick={() => setModalOpen(true)}
        />
      )}

      {data && (
        <MVOptimizationModal
          mvConfigs={mvConfigs}
          explanations={data.explanations}
          opened={modalOpen}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
