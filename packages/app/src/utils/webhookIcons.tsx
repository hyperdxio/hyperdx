import React from 'react';
import {
  WebhookApiData,
  WebhookService,
} from '@hyperdx/common-utils/dist/types';
import { IconBrandSlack, IconLink, IconMail } from '@tabler/icons-react';

import { IncidentIOIcon } from '@/SVGIcons';

export interface ServiceConfig {
  name: string;
  icon: React.ReactElement;
  order: number;
}

// Service type configuration with icons and display names
export const WEBHOOK_SERVICE_CONFIG: Record<WebhookService, ServiceConfig> = {
  [WebhookService.Slack]: {
    name: 'Slack',
    icon: <IconBrandSlack size={16} />,
    order: 1,
  },
  [WebhookService.IncidentIO]: {
    name: 'incident.io',
    icon: <IncidentIOIcon width={16} />,
    order: 4,
  },
  [WebhookService.Generic]: {
    name: 'Generic',
    icon: <IconLink size={16} />,
    order: 5,
  },
} as const;

// Channel icons for alert display (smaller sizes)
export const CHANNEL_ICONS: Record<WebhookService, React.ReactElement> = {
  [WebhookService.Generic]: <IconLink size={16} />,
  [WebhookService.Slack]: <IconBrandSlack size={16} />,
  [WebhookService.IncidentIO]: <IncidentIOIcon width={16} />,
} as const;

/**
 * Get webhook service configuration by service type
 */
export const getWebhookServiceConfig = (
  serviceType: string | undefined,
): ServiceConfig | undefined => {
  if (!serviceType) return undefined;
  return WEBHOOK_SERVICE_CONFIG[serviceType as WebhookService];
};

/**
 * Get webhook service icon for display in lists/headers
 */
export const getWebhookServiceIcon = (
  serviceType: string | undefined,
): React.ReactElement => {
  const config = getWebhookServiceConfig(serviceType);
  return config?.icon || WEBHOOK_SERVICE_CONFIG[WebhookService.Generic].icon;
};

/**
 * Get webhook channel icon for alert tabs/smaller displays
 */
export const getWebhookChannelIcon = (
  serviceType: string | undefined,
): React.ReactElement => {
  if (!serviceType) return CHANNEL_ICONS[WebhookService.Generic];
  return (
    CHANNEL_ICONS[serviceType as keyof typeof CHANNEL_ICONS] ||
    CHANNEL_ICONS[WebhookService.Generic]
  );
};

/**
 * Get webhook service display name
 */
export const getWebhookServiceName = (
  serviceType: string | undefined,
): string => {
  const config = getWebhookServiceConfig(serviceType);
  return config?.name || serviceType || 'Unknown';
};

/**
 * Helper function to group webhooks by service type
 */
export const groupWebhooksByService = (webhooks: WebhookApiData[]) => {
  const grouped = webhooks.reduce(
    (acc, webhook) => {
      const service = webhook.service;
      if (!acc[service]) {
        acc[service] = [];
      }
      acc[service].push(webhook);
      return acc;
    },
    {} as Record<string, WebhookApiData[]>,
  );

  // Sort groups by predefined order
  return Object.entries(grouped).sort(([a], [b]) => {
    const orderA = WEBHOOK_SERVICE_CONFIG[a as WebhookService]?.order || 999;
    const orderB = WEBHOOK_SERVICE_CONFIG[b as WebhookService]?.order || 999;
    return orderA - orderB;
  });
};
