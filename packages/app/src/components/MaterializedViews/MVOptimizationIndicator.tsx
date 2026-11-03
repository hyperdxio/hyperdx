import { useState } from 'react';
import { Badge } from '@clickhouse/click-ui';
import {
  BuilderChartConfigWithOptDateRange,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { ActionIcon, Tooltip } from '@mantine/core';
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
  return isInWarningState ? (
    <Tooltip label="Not accelerated">
      <ActionIcon
        onClick={onClick}
        aria-label="Not accelerated"
        data-testid="mv-optimization-indicator"
        data-mv-accelerated="false"
      >
        <IconBoltOff size={16} color={WARNING_COLOR} />
      </ActionIcon>
    </Tooltip>
  ) : (
    <Tooltip label="Accelerated">
      <ActionIcon
        onClick={onClick}
        aria-label="Accelerated"
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
  return (
    <Badge
      text={isInWarningState ? 'Not accelerated' : 'Accelerated'}
      state={isInWarningState ? 'warning' : 'success'}
      onClick={onClick}
      className="cursor-pointer"
      data-testid="mv-optimization-indicator"
      data-mv-accelerated={isInWarningState ? 'false' : 'true'}
    />
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
