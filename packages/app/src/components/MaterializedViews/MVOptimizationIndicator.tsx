import { useState } from 'react';
import {
  ChartConfigWithOptDateRange,
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
  return isInWarningState ? (
    <Tooltip label="Not Accelerated">
      <ActionIcon onClick={onClick}>
        <IconBoltOff size={16} color={WARNING_COLOR} />
      </ActionIcon>
    </Tooltip>
  ) : (
    <Tooltip label="Accelerated">
      <ActionIcon onClick={onClick}>
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
      color={isInWarningState ? WARNING_COLOR : SUCCESS_COLOR}
      onClick={onClick}
      className="cursor-pointer"
    >
      {isInWarningState ? 'Not Accelerated' : 'Accelerated'}
    </Badge>
  );
}

export default function MVOptimizationIndicator({
  source,
  config,
  variant = 'badge',
}: {
  source: TSource;
  config: ChartConfigWithOptDateRange | undefined;
  variant?: 'badge' | 'icon';
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const { data } = useMVOptimizationExplanation(config);

  const mvConfigs = source.materializedViews ?? [];
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
