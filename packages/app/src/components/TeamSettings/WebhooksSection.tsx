import { Fragment, useMemo, useState } from 'react';
import { HTTPError } from 'ky';
import { useTranslation } from 'react-i18next';
import {
  WebhookApiData,
  WebhookService,
} from '@hyperdx/common-utils/dist/types';
import { Button, Divider, Group, Stack, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPencil, IconX } from '@tabler/icons-react';

import api from '@/api';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { useConfirm } from '@/useConfirm';
import {
  getWebhookServiceConfig,
  getWebhookServiceName,
  groupWebhooksByService,
} from '@/utils/webhookIcons';

import { WebhookForm } from './WebhookForm';

function DeleteWebhookButton({
  webhookId,
  webhookName,
  onSuccess,
}: {
  webhookId: string;
  webhookName: string;
  onSuccess: VoidFunction;
}) {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const brandName = useBrandDisplayName();
  const confirm = useConfirm();
  const deleteWebhook = api.useDeleteWebhook();

  const handleDelete = async () => {
    if (
      await confirm(
        t('webhooks.deleteConfirm', { name: webhookName }),
        tCommon('actions.delete'),
        { variant: 'danger' },
      )
    ) {
      try {
        await deleteWebhook.mutateAsync({ id: webhookId });
        notifications.show({
          color: 'green',
          message: t('webhooks.deleted'),
        });
        onSuccess();
      } catch (e) {
        console.error(e);
        const message =
          (e instanceof HTTPError
            ? (await e.response.json())?.message
            : null) || tCommon('errors.contactTeam', { brandName });
        notifications.show({
          message,
          color: 'red',
          autoClose: 5000,
        });
      }
    }
  };

  return (
    <Button
      size="compact-xs"
      variant="danger"
      onClick={handleDelete}
      loading={deleteWebhook.isPending}
    >
      {tCommon('actions.delete')}
    </Button>
  );
}

export default function WebhooksSection() {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { data: webhookData, refetch: refetchWebhooks } = api.useWebhooks([
    WebhookService.Slack,
    WebhookService.Generic,
    WebhookService.IncidentIO,
  ]);

  const [editedWebhookId, setEditedWebhookId] = useState<string | null>(null);

  const allWebhooks = useMemo((): WebhookApiData[] => {
    return Array.isArray(webhookData?.data) ? webhookData?.data || [] : [];
  }, [webhookData]);

  const groupedWebhooks = useMemo(() => {
    return groupWebhooksByService(allWebhooks);
  }, [allWebhooks]);

  const [
    isAddWebhookModalOpen,
    { open: openWebhookModal, close: closeWebhookModal },
  ] = useDisclosure();

  return (
    <>
      <Text mb="xs">{t('webhooks.title')}</Text>

      <Stack>
        {groupedWebhooks.length === 0 ? (
          <Text
            data-testid="webhooks-empty-state"
            size="sm"
            c="dimmed"
            ta="center"
            py="xl"
          >
            {t('webhooks.empty')}
          </Text>
        ) : (
          groupedWebhooks.map(([serviceType, webhooks]) => {
            const config = getWebhookServiceConfig(serviceType);
            return (
              <Stack key={serviceType} gap="xs">
                {/* Service type header with icon */}
                <Group gap="xs" mt="md" mb="xs">
                  {config?.icon}
                  <Title order={6} c="dimmed">
                    {getWebhookServiceName(serviceType)}
                  </Title>
                </Group>

                {/* Webhooks in this service type */}
                <Stack>
                  {webhooks.map(webhook => (
                    <Fragment key={webhook._id}>
                      <Group justify="space-between" align="flex-start">
                        <Stack gap={0}>
                          <Text size="sm">
                            {webhook.name} ({webhook.service})
                          </Text>
                          <Text size="xs" opacity={0.7}>
                            {webhook.url}
                          </Text>
                          {webhook.description && (
                            <Text size="xxs" opacity={0.7}>
                              {webhook.description}
                            </Text>
                          )}
                        </Stack>

                        <Group gap="xs">
                          {editedWebhookId !== webhook._id ? (
                            <>
                              <Button
                                variant="subtle"
                                color="gray.4"
                                onClick={() => setEditedWebhookId(webhook._id)}
                                size="compact-xs"
                                leftSection={<IconPencil size={14} />}
                              >
                                {tCommon('actions.edit')}
                              </Button>
                              <DeleteWebhookButton
                                webhookId={webhook._id}
                                webhookName={webhook.name}
                                onSuccess={refetchWebhooks}
                              />
                            </>
                          ) : (
                            <Button
                              variant="subtle"
                              color="gray.4"
                              onClick={() => setEditedWebhookId(null)}
                              size="compact-xs"
                            >
                              <IconX size={16} /> {tCommon('actions.cancel')}
                            </Button>
                          )}
                        </Group>
                      </Group>
                      {editedWebhookId === webhook._id && (
                        <WebhookForm
                          webhook={webhook}
                          onClose={() => setEditedWebhookId(null)}
                          onSuccess={() => {
                            setEditedWebhookId(null);
                            refetchWebhooks();
                          }}
                        />
                      )}
                      <Divider />
                    </Fragment>
                  ))}
                </Stack>
              </Stack>
            );
          })
        )}
      </Stack>

      {!isAddWebhookModalOpen ? (
        <Button
          data-testid="add-webhook-section-button"
          variant="secondary"
          onClick={openWebhookModal}
        >
          {t('webhooks.add')}
        </Button>
      ) : (
        <WebhookForm
          onClose={closeWebhookModal}
          onSuccess={() => {
            refetchWebhooks();
            closeWebhookModal();
          }}
        />
      )}
    </>
  );
}
