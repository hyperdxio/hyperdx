import React from 'react';
import { Badge, Tooltip } from '@mantine/core';

import { ServiceReadiness } from '@/types';

const READINESS_CONFIG = {
  [ServiceReadiness.GOLD]: { color: 'yellow', label: 'Gold', tooltip: 'Excellent Readiness' },
  [ServiceReadiness.SILVER]: { color: 'gray', label: 'Silver', tooltip: 'Good Readiness' },
  [ServiceReadiness.BRONZE]: { color: 'orange', label: 'Bronze', tooltip: 'Basic Readiness' },
  [ServiceReadiness.FAIL]: { color: 'red', label: 'Needs Attention', tooltip: 'Missing Critical Telemetry or Metadata' },
};

export const ServiceReadinessBadge = ({ readiness }: { readiness?: ServiceReadiness }) => {
  const config = READINESS_CONFIG[readiness || ServiceReadiness.FAIL];

  return (
    <Tooltip label={config.tooltip}>
      <Badge color={config.color} variant="filled">
        {config.label}
      </Badge>
    </Tooltip>
  );
};

