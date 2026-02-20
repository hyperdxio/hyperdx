import { useEffect } from 'react';
import { HTTPError } from 'ky';
import { Controller, SubmitHandler, useForm, useWatch } from 'react-hook-form';
import { ZodIssue } from 'zod';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter } from '@codemirror/lint';
import {
  AlertState,
  WebhookApiData,
  WebhookService,
} from '@hyperdx/common-utils/dist/types';
import { isValidSlackUrl } from '@hyperdx/common-utils/dist/validation';
import {
  Alert,
  Button,
  Group,
  Radio,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconInfoCircleFilled } from '@tabler/icons-react';
import ReactCodeMirror, {
  EditorView,
  placeholder,
} from '@uiw/react-codemirror';

import api from '@/api';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { isValidUrl } from '@/utils';

const DEFAULT_GENERIC_WEBHOOK_BODY = [
  '{{title}}',
  '{{body}}',
  '{{link}}',
  '{{state}}',
  '{{startTime}}',
  '{{endTime}}',
  '{{eventId}}',
];
const DEFAULT_GENERIC_WEBHOOK_BODY_TEMPLATE =
  DEFAULT_GENERIC_WEBHOOK_BODY.join(' | ');

const jsonLinterWithEmptyCheck = () => (editorView: EditorView) => {
  const text = editorView.state.doc.toString().trim();
  if (text === '') return [];
  return jsonParseLinter()(editorView);
};

type WebhookForm = {
  name: string;
  url: string;
  service: WebhookService;
  description?: string;
  body?: string;
  headers?: string;
};

export function WebhookForm({
  webhook,
  onClose,
  onSuccess,
}: {
  webhook?: WebhookApiData;
  onClose: VoidFunction;
  onSuccess: (webhookId?: string) => void;
}) {
  const brandName = useBrandDisplayName();
  const saveWebhook = api.useSaveWebhook();
  const updateWebhook = api.useUpdateWebhook();
  const testWebhook = api.useTestWebhook();
  const isEditing = webhook != null;

  const form = useForm<WebhookForm>({
    defaultValues: {
      service: webhook?.service || WebhookService.Slack,
      name: webhook?.name || '',
      url: webhook?.url || '',
      description: webhook?.description || '',
      body: webhook?.body || '',
      headers: webhook?.headers ? JSON.stringify(webhook.headers, null, 2) : '',
    },
  });

  useEffect(() => {
    if (webhook) {
      form.reset(
        {
          service: webhook.service,
          name: webhook.name,
          url: webhook.url,
          description: webhook.description,
          body: webhook.body,
          headers: webhook.headers
            ? JSON.stringify(webhook.headers, null, 2)
            : '',
        },
        {},
      );
    }
  }, [webhook, form]);

  const handleTestWebhook = async (values: WebhookForm) => {
    const { service, url, body, headers } = values;

    // Parse headers if provided
    let parsedHeaders: Record<string, string> | undefined;
    if (headers && headers.trim()) {
      try {
        parsedHeaders = JSON.parse(headers);
      } catch (parseError) {
        const errorMessage =
          parseError instanceof Error
            ? parseError.message
            : 'Invalid JSON format';
        notifications.show({
          message: `Invalid JSON in headers: ${errorMessage}`,
          color: 'red',
          autoClose: 5000,
        });
        return;
      }
    }

    let defaultBody = body;
    if (!body) {
      if (service === WebhookService.Generic) {
        defaultBody = `{"text": "${DEFAULT_GENERIC_WEBHOOK_BODY_TEMPLATE}"}`;
      } else if (service === WebhookService.IncidentIO) {
        defaultBody = `{
  "title": "{{title}}",
  "description": "{{body}}",
  "deduplication_key": "{{eventId}}",
  "status": "{{#if (eq state "${AlertState.ALERT}")}}firing{{else}}resolved{{/if}}",
  "source_url": "{{link}}"
}`;
      }
    }

    try {
      await testWebhook.mutateAsync({
        service,
        url,
        body: defaultBody,
        headers: parsedHeaders,
      });
      notifications.show({
        color: 'green',
        message: 'Test webhook sent successfully',
      });
    } catch (e) {
      console.error(e);
      let message =
        'Failed to send test webhook. Please check your webhook configuration.';

      if (e instanceof HTTPError) {
        try {
          const errorData = await e.response.json();
          if (errorData.message) {
            message = errorData.message;
          }
        } catch (parseError) {
          console.error('Failed to parse error response:', parseError);
        }
      }

      notifications.show({
        message,
        color: 'red',
        autoClose: 5000,
      });
    }
  };

  const onSubmit: SubmitHandler<WebhookForm> = async values => {
    const { service, name, url, description, body, headers } = values;

    try {
      // Parse headers JSON if provided (API will validate the content)
      let parsedHeaders: Record<string, string> | undefined;
      if (headers && headers.trim()) {
        try {
          parsedHeaders = JSON.parse(headers);
        } catch (parseError) {
          const errorMessage =
            parseError instanceof Error
              ? parseError.message
              : 'Invalid JSON format';
          notifications.show({
            message: `Invalid JSON in headers: ${errorMessage}`,
            color: 'red',
            autoClose: 5000,
          });
          return;
        }
      }

      let defaultBody = body;
      if (!body) {
        if (service === WebhookService.Generic) {
          defaultBody = `{"text": "${DEFAULT_GENERIC_WEBHOOK_BODY_TEMPLATE}"}`;
        } else if (service === WebhookService.IncidentIO) {
          defaultBody = `{
  "title": "{{title}}",
  "description": "{{body}}",
  "deduplication_key": "{{eventId}}",
  "status": "{{#if (eq state "${AlertState.ALERT}")}}firing{{else}}resolved{{/if}}",
  "source_url": "{{link}}"
}`;
        }
      }

      const webhookData = {
        service,
        name,
        url,
        description: description || '',
        body: defaultBody,
        headers: parsedHeaders,
      };

      const response = isEditing
        ? await updateWebhook.mutateAsync({
            id: webhook._id,
            ...webhookData,
          })
        : await saveWebhook.mutateAsync(webhookData);

      notifications.show({
        color: 'green',
        message: `Webhook ${isEditing ? 'updated' : 'created'} successfully`,
      });
      onSuccess(response.data?._id);
      onClose();
    } catch (e) {
      console.error(e);
      let message = `Something went wrong. Please contact ${brandName} team.`;

      if (e instanceof HTTPError) {
        try {
          const errorData = await e.response.json();
          // Handle Zod validation errors from zod-express-middleware
          // The library returns errors in format: { error: { issues: [...] } }
          if (
            errorData.error?.issues &&
            Array.isArray(errorData.error.issues)
          ) {
            // TODO: use a library to format Zod validation errors
            // Format Zod validation errors
            const validationErrors = errorData.error.issues
              .map((issue: ZodIssue) => {
                const path = issue.path.join('.');
                return `${path}: ${issue.message}`;
              })
              .join(', ');
            message = `Validation error: ${validationErrors}`;
          } else if (errorData.message) {
            message = errorData.message;
          } else {
            // Fallback: show the entire error object as JSON
            message = JSON.stringify(errorData);
          }
        } catch (parseError) {
          console.error('Failed to parse error response:', parseError);
          // If parsing fails, use default message
        }
      }

      notifications.show({
        message,
        color: 'red',
        autoClose: 5000,
      });
    }
  };

  const service = useWatch({ control: form.control, name: 'service' });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Stack mt="sm">
        <Text>{isEditing ? 'Edit Webhook' : 'Create Webhook'}</Text>
        <Radio.Group
          label="Service Type"
          required
          value={service}
          onChange={value => form.setValue('service', value as WebhookService)}
        >
          <Group mt="xs">
            <Radio value={WebhookService.Slack} label="Slack" />
            <Radio value={WebhookService.IncidentIO} label="incident.io" />
            <Radio value={WebhookService.Generic} label="Generic" />
          </Group>
        </Radio.Group>
        <TextInput
          label="Webhook Name"
          placeholder="Post to #dev-alerts"
          required
          error={form.formState.errors.name?.message}
          {...form.register('name', { required: true })}
        />

        <TextInput
          label="Webhook URL"
          placeholder={
            service === WebhookService.Slack
              ? 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX'
              : service === WebhookService.IncidentIO
                ? 'https://api.incident.io/v2/alert_events/http/ZZZZZZZZ?token=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
                : 'https://example.com/webhook'
          }
          type="url"
          required
          error={form.formState.errors.url?.message}
          {...form.register('url', {
            required: true,
            validate: (value, formValues) =>
              formValues.service === WebhookService.Slack
                ? isValidSlackUrl(value) ||
                  'URL must be valid and have a slack.com domain'
                : isValidUrl(value) || 'URL must be valid',
          })}
        />

        <TextInput
          label="Webhook Description (optional)"
          placeholder="To be used for dev alerts"
          error={form.formState.errors.description?.message}
          {...form.register('description')}
        />
        {service === WebhookService.Generic && [
          <label className=".mantine-TextInput-label" key="1">
            Webhook Headers (optional)
          </label>,
          <div className="mb-2" key="2">
            <Controller
              name="headers"
              control={form.control}
              render={({ field }) => (
                <ReactCodeMirror
                  height="100px"
                  extensions={[
                    json(),
                    linter(jsonLinterWithEmptyCheck()),
                    placeholder(
                      `{\n\t"Authorization": "Bearer token",\n\t"X-Custom-Header": "value"\n}`,
                    ),
                  ]}
                  theme="dark"
                  value={field.value}
                  onChange={value => field.onChange(value)}
                />
              )}
            />
          </div>,
          <label className=".mantine-TextInput-label" key="3">
            Webhook Body (optional)
          </label>,
          <div className="mb-2" key="4">
            <Controller
              name="body"
              control={form.control}
              render={({ field }) => (
                <ReactCodeMirror
                  height="100px"
                  extensions={[
                    json(),
                    linter(jsonLinterWithEmptyCheck()),
                    placeholder(
                      `{\n\t"text": "${DEFAULT_GENERIC_WEBHOOK_BODY_TEMPLATE}"\n}`,
                    ),
                  ]}
                  theme="dark"
                  value={field.value}
                  onChange={value => field.onChange(value)}
                />
              )}
            />
          </div>,
          <Alert
            icon={<IconInfoCircleFilled size={16} />}
            key="5"
            className="mb-4"
            color="gray"
          >
            <span>
              Currently the body supports the following message template
              variables:
            </span>
            <br />
            <span>
              {DEFAULT_GENERIC_WEBHOOK_BODY.map((body, index) => (
                <span key={index}>
                  <code>{body}</code>
                  {index < DEFAULT_GENERIC_WEBHOOK_BODY.length - 1 && ', '}
                </span>
              ))}
            </span>
          </Alert>,
        ]}
        <Group justify="space-between">
          <Group>
            <Button
              variant="primary"
              type="submit"
              loading={saveWebhook.isPending || updateWebhook.isPending}
            >
              {isEditing ? 'Update Webhook' : 'Add Webhook'}
            </Button>
            <Button
              variant="secondary"
              onClick={form.handleSubmit(handleTestWebhook)}
              loading={testWebhook.isPending}
              type="button"
            >
              Test Webhook
            </Button>
          </Group>
          <Button variant="secondary" onClick={onClose} type="reset">
            Cancel
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
