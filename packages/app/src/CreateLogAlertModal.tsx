import { Button, Form, Modal } from 'react-bootstrap';
import { Controller, useForm } from 'react-hook-form';
import { sub } from 'date-fns';
import { toast } from 'react-toastify';
import { useEffect, useMemo, useState } from 'react';

import HDXLineChart from './HDXLineChart';
import TabBar from './TabBar';
import api from './api';
import { FieldSelect } from './ChartUtils';
import { capitalizeFirstLetter } from './utils';
import { genEnglishExplanation } from './queryv2';

import type { AlertChannelType, AlertInterval, LogView } from './types';

function intervalToGranularity(interval: AlertInterval) {
  if (interval === '1m') return '1 minute' as const;
  if (interval === '5m') return '5 minute' as const;
  if (interval === '15m') return '15 minute' as const;
  if (interval === '30m') return '30 minute' as const;
  if (interval === '1h') return '1 hour' as const;
  if (interval === '6h') return '6 hour' as const;
  if (interval === '12h') return '12 hour' as const;
  if (interval === '1d') return '1 day' as const;
  return '1 day';
}

function intervalToDateRange(interval: AlertInterval): [Date, Date] {
  const now = new Date();
  if (interval === '1m') return [sub(now, { minutes: 15 }), now];
  if (interval === '5m') return [sub(now, { hours: 1 }), now];
  if (interval === '15m') return [sub(now, { hours: 4 }), now];
  if (interval === '30m') return [sub(now, { hours: 8 }), now];
  if (interval === '1h') return [sub(now, { hours: 16 }), now];
  if (interval === '6h') return [sub(now, { days: 4 }), now];
  if (interval === '12h') return [sub(now, { days: 7 }), now];
  if (interval === '1d') return [sub(now, { days: 7 }), now];
  return [now, now];
}

function AlertForm({
  alertId,
  defaultValues,
  onDeleteClick,
  onSubmit,
  query,
}: {
  defaultValues:
    | {
        channelType: AlertChannelType;
        groupBy: string | undefined;
        interval: AlertInterval;
        threshold: number;
        type: string;
        webhookId: string | undefined;
      }
    | undefined;
  alertId: string | undefined;
  onSubmit: (values: {
    channelType: AlertChannelType;
    groupBy: string | undefined;
    interval: AlertInterval;
    threshold: number;
    type: string;
    webhookId: string | undefined;
  }) => void;
  onDeleteClick: () => void;
  query: string;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    control,
  } = useForm({
    defaultValues:
      defaultValues != null
        ? {
            channelType: defaultValues.channelType,
            interval: defaultValues.interval,
            threshold: defaultValues.threshold,
            type: defaultValues.type,
            webhookId: defaultValues.webhookId,
            groupBy: defaultValues.groupBy,
          }
        : undefined,
  });
  const { data: slackWebhooks } = api.useWebhooks('slack');
  const { data: team } = api.useTeam();

  const channel = watch('channelType');
  const interval = watch('interval');
  const groupBy = watch('groupBy');
  const threshold = watch('threshold');
  const type = watch('type');

  const previewChartConfig = useMemo(() => {
    return {
      table: 'logs' as const,
      aggFn: 'count' as const,
      field: '',
      groupBy: groupBy ?? '',
      where: query,
      dateRange: intervalToDateRange(interval),
      granularity: intervalToGranularity(interval),
    };
  }, [interval, query, groupBy]);

  return (
    <Form onSubmit={handleSubmit(data => onSubmit(data))}>
      <div className="d-flex align-items-center mt-4 flex-wrap">
        <div className="me-2 mb-2">Alert when</div>
        <div className="me-2 mb-2">
          <Form.Select id="type" size="sm" {...register('type')}>
            <option value="presence">More Than</option>
            <option value="absence">Less Than</option>
          </Form.Select>
        </div>
        <Form.Control
          style={{ width: 70 }}
          className="me-2 mb-2"
          type="number"
          id="threshold"
          size="sm"
          defaultValue={1}
          {...register('threshold')}
        />
        <div className="me-2 mb-2">lines appear within</div>
        <div className="me-2 mb-2">
          <Form.Select id="interval" size="sm" {...register('interval')}>
            <option value="1m">1 minute</option>
            <option value="5m">5 minutes</option>
            <option value="15m">15 minutes</option>
            <option value="30m">30 minutes</option>
            <option value="1h">1 hour</option>
            <option value="6h">6 hours</option>
            <option value="12h">12 hours</option>
            <option value="1d">1 day</option>
          </Form.Select>
        </div>
        <div className="d-flex align-items-center">
          <div className="me-2 mb-2">grouped by</div>
          <div className="me-2 mb-2" style={{ minWidth: 300 }}>
            <Controller
              control={control}
              name="groupBy"
              render={({ field: { onChange, value } }) => (
                <FieldSelect
                  value={value}
                  setValue={onChange}
                  types={['number', 'string', 'bool']}
                  className="input-bg"
                />
              )}
            />
          </div>
        </div>
        <div className="d-flex align-items-center">
          <div className="me-2 mb-2">via</div>
          <div className="me-2 mb-2">
            <Form.Select id="channel" size="sm" {...register('channelType')}>
              <option value="webhook">Slack Webhook</option>
            </Form.Select>
          </div>
        </div>
      </div>
      <div className="d-flex align-items-center mb-2"></div>
      {channel === 'webhook' &&
        Array.isArray(slackWebhooks?.data) &&
        slackWebhooks.data.length > 0 && (
          <div className="mt-3">
            <Form.Label>Slack Webhook</Form.Label>
            <Form.Select
              className="bg-black border-0 mb-4 px-3"
              id="webhookId"
              size="sm"
              {...register('webhookId')}
            >
              {slackWebhooks.data.map((sw: any) => (
                <option key={sw._id} value={sw._id}>
                  {sw.name}
                </option>
              ))}
            </Form.Select>
          </div>
        )}
      {channel === 'webhook' && (
        <div className="mb-4">
          <a href="/team" target="_blank">
            <i className="bi bi-plus me-1" />
            Add New Slack Incoming Webhook
          </a>
        </div>
      )}
      <div className="d-flex justify-content-between mt-4">
        <Button
          variant="outline-success"
          className="fs-7 text-muted-hover"
          type="submit"
        >
          Save
        </Button>
        {alertId != null ? (
          <Button onClick={onDeleteClick} variant="dark">
            Delete
          </Button>
        ) : null}
      </div>
      <div className="mt-4">
        <div className="mb-3 text-muted ps-2 fs-7">Alert Threshold Preview</div>
        <div style={{ height: 400 }}>
          <HDXLineChart
            config={previewChartConfig}
            alertThreshold={threshold}
            alertThresholdType={type === 'presence' ? 'above' : 'below'}
          />
        </div>
      </div>
    </Form>
  );
}

export default function CreateLogAlertModal({
  savedSearch,
  onSaveSuccess,
  onDeleteSuccess,
  onSavedSearchCreateSuccess,
  show,
  onHide,
  query,
}: {
  savedSearch: LogView | undefined;
  onSaveSuccess: () => void;
  onDeleteSuccess: () => void;
  onSavedSearchCreateSuccess: (responseData: any) => void;
  show: boolean;
  onHide: () => void;
  query: string;
}) {
  const saveAlert = api.useSaveAlert();
  const updateAlert = api.useUpdateAlert();
  const deleteAlert = api.useDeleteAlert();
  const saveLogView = api.useSaveLogView();

  const alerts = savedSearch?.alerts ?? [];
  const [selectedAlertId, setSelectedAlertId] = useState<string | undefined>(
    undefined,
  );

  const selectedAlert = alerts.find(alert => alert._id === selectedAlertId);

  const onClickDeleteAlert = (alertId: string) => {
    if (savedSearch) {
      deleteAlert.mutate(alertId, {
        onSuccess: () => {
          onDeleteSuccess();
          setSelectedAlertId(alerts?.[0]?._id);
        },
        onError: () => {
          toast.error(
            'An error occurred. Please contact support for more details.',
          );
        },
      });
    }
  };

  const [savedSearchName, setSavedSearchName] = useState<string | undefined>(
    undefined,
  );
  const [parsedEnglishQuery, setParsedEnglishQuery] = useState<string>('');
  useEffect(() => {
    genEnglishExplanation(query).then(q => {
      setParsedEnglishQuery(q === '' ? 'All Events' : q);
    });
  }, [query]);

  const displayedSavedSearchName = savedSearchName ?? parsedEnglishQuery;

  return (
    <Modal
      aria-labelledby="contained-modal-title-vcenter"
      centered
      onHide={onHide}
      show={show}
      size="xl"
    >
      <Modal.Body className="bg-hdx-dark rounded">
        <div className="d-flex align-items-center mt-3 mb-2">
          <h5 className="text-nowrap me-3 my-0">Alerts for</h5>
          {savedSearch == null ? (
            <Form.Control
              type="text"
              id="name"
              value={displayedSavedSearchName}
              onChange={e => {
                setSavedSearchName(e.target.value);
              }}
              placeholder="Your Saved Search Name"
            />
          ) : (
            <span className="fs-6 fw-bold">{savedSearch?.name}</span>
          )}
        </div>
        <div className="fs-8 text-muted">
          <span className="fw-bold">Query: </span>
          <span>{query}</span>
        </div>
        <TabBar
          className="fs-8 mt-3"
          items={[
            ...alerts.map((alert, i) => ({
              text: `${capitalizeFirstLetter(alert.channel.type)} Alert ${
                i + 1
              }`,
              value: alert._id,
            })),
            {
              text: 'New Alert',
              value: undefined,
            },
          ]}
          activeItem={selectedAlertId}
          onClick={(alertId: string | undefined) => setSelectedAlertId(alertId)}
        />
        {selectedAlert == null ? (
          <AlertForm
            onSubmit={async ({
              channelType,
              groupBy,
              interval,
              threshold,
              type,
              webhookId,
            }) => {
              let savedSearchId = savedSearch?._id;
              if (savedSearch == null) {
                try {
                  if (
                    displayedSavedSearchName == null ||
                    displayedSavedSearchName.length === 0
                  ) {
                    toast.error(
                      'You must enter a saved search name to create an alert.',
                    );
                    return;
                  }
                  const savedSearch = await saveLogView.mutateAsync({
                    name: displayedSavedSearchName,
                    query: query ?? '',
                  });
                  savedSearchId = savedSearch.data._id;
                  onSavedSearchCreateSuccess(savedSearch.data);
                } catch (e) {
                  toast.error(
                    'An error occurred while saving the search for this alert. Please contact support for more details.',
                  );
                  return;
                }
              }
              if (savedSearchId != null) {
                saveAlert.mutate(
                  {
                    type,
                    threshold,
                    interval,
                    groupBy,
                    channel: {
                      type: channelType,
                      ...(channelType === 'webhook' && {
                        webhookId,
                      }),
                    },
                    logViewId: savedSearchId,
                  },
                  {
                    onSuccess: response => {
                      setSelectedAlertId(response?.data?._id);
                      onSaveSuccess();
                    },
                    onError: () => {
                      toast.error(
                        'An error occurred. Please contact support for more details.',
                      );
                    },
                  },
                );
              } else {
                toast.error(
                  'An error occurred while saving the search for this alert. Please contact support for more details.',
                );
              }
            }}
            alertId={undefined}
            defaultValues={undefined}
            onDeleteClick={() => {}}
            query={query}
          />
        ) : null}
        {selectedAlert != null && selectedAlertId != null ? (
          <AlertForm
            query={query}
            onDeleteClick={() => {
              onClickDeleteAlert(selectedAlertId);
            }}
            key={selectedAlertId}
            onSubmit={({
              channelType,
              groupBy,
              interval,
              threshold,
              type,
              webhookId,
            }) => {
              if (savedSearch != null && selectedAlertId != null) {
                // use useUpdateAlert
                updateAlert.mutate(
                  {
                    id: selectedAlertId,
                    type,
                    threshold,
                    interval,
                    groupBy,
                    channel: { type: 'webhook', webhookId },
                    logViewId: savedSearch._id,
                  },
                  {
                    onSuccess: response => {
                      onSaveSuccess();
                      // toast.success('The alert is saved.');
                      // refetchLogViews();
                    },
                    onError: () => {
                      toast.error(
                        'An error occurred. Please contact support for more details.',
                      );
                    },
                  },
                );
              }
            }}
            alertId={selectedAlertId}
            defaultValues={{
              type: selectedAlert.type,
              threshold: selectedAlert.threshold,
              interval: selectedAlert.interval,
              channelType: selectedAlert.channel.type,
              groupBy: selectedAlert.groupBy,
              webhookId:
                selectedAlert.channel.type === 'webhook'
                  ? selectedAlert.channel.webhookId
                  : undefined,
            }}
          />
        ) : null}
      </Modal.Body>
    </Modal>
  );
}
