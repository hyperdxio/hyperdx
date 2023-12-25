import { useEffect, useMemo, useState } from 'react';
import produce from 'immer';
import { Button, Form, InputGroup, Modal } from 'react-bootstrap';
import Select from 'react-select';
import { Divider, Group, Paper } from '@mantine/core';

import { NumberFormatInput } from './components/NumberFormat';
import { intervalToGranularity } from './Alert';
import {
  AGG_FNS,
  AggFn,
  ChartSeriesForm,
  convertDateRangeToGranularityString,
  FieldSelect,
} from './ChartUtils';
import Checkbox from './Checkbox';
import * as config from './config';
import { METRIC_ALERTS_ENABLED } from './config';
import EditChartFormAlerts from './EditChartFormAlerts';
import HDXHistogramChart from './HDXHistogramChart';
import HDXLineChart from './HDXLineChart';
import HDXMarkdownChart from './HDXMarkdownChart';
import HDXNumberChart from './HDXNumberChart';
import HDXTableChart from './HDXTableChart';
import { LogTableWithSidePanel } from './LogTableWithSidePanel';
import type { Alert, NumberFormat } from './types';
import { hashCode, useDebounce } from './utils';

export type Chart = {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  series: (
    | {
        table: string;
        type: 'time';
        aggFn: AggFn; // TODO: Type
        field: string | undefined;
        where: string;
        groupBy: string[];
        numberFormat?: NumberFormat;
      }
    | {
        table: string;
        type: 'histogram';
        field: string | undefined;
        where: string;
      }
    | {
        type: 'search';
        fields: string[];
        where: string;
      }
    | {
        type: 'number';
        table: string;
        aggFn: AggFn;
        field: string | undefined;
        where: string;
        numberFormat?: NumberFormat;
      }
    | {
        type: 'table';
        table: string;
        aggFn: AggFn;
        field: string | undefined;
        where: string;
        groupBy: string[];
        sortOrder: 'desc' | 'asc';
        numberFormat?: NumberFormat;
      }
    | {
        type: 'markdown';
        content: string;
      }
  )[];
};

const DEFAULT_ALERT: Alert = {
  channel: {
    type: 'webhook',
  },
  threshold: 1,
  interval: '5m',
  type: 'presence',
  source: 'CHART',
};

export const EditMarkdownChartForm = ({
  chart,
  onClose,
  onSave,
}: {
  chart: Chart | undefined;
  onSave: (chart: Chart) => void;
  onClose: () => void;
}) => {
  const [editedChart, setEditedChart] = useState<Chart | undefined>(chart);

  const chartConfig = useMemo(() => {
    return editedChart != null && editedChart.series[0].type === 'markdown'
      ? {
          content: editedChart.series[0].content,
        }
      : null;
  }, [editedChart]);
  const previewConfig = chartConfig;

  if (
    chartConfig == null ||
    editedChart == null ||
    previewConfig == null ||
    editedChart.series[0].type !== 'markdown'
  ) {
    return null;
  }

  const labelWidth = 320;

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSave(editedChart);
      }}
    >
      <div className="fs-5 mb-4">Markdown</div>
      <div className="d-flex align-items-center mb-4">
        <Form.Control
          type="text"
          id="name"
          onChange={e =>
            setEditedChart(
              produce(editedChart, draft => {
                draft.name = e.target.value;
              }),
            )
          }
          defaultValue={editedChart.name}
          placeholder="Title"
        />
      </div>
      <div className="d-flex mt-3 align-items-center">
        <div style={{ width: labelWidth }} className="text-muted fw-500 ps-2">
          Content
        </div>
        <div className="ms-3 flex-grow-1">
          <InputGroup>
            <Form.Control
              as="textarea"
              type="text"
              placeholder={'Markdown content'}
              className="border-0 fs-7"
              value={editedChart.series[0].content}
              onChange={event =>
                setEditedChart(
                  produce(editedChart, draft => {
                    if (draft.series[0].type === 'markdown') {
                      draft.series[0].content = event.target.value;
                    }
                  }),
                )
              }
            />
          </InputGroup>
        </div>
      </div>
      <div className="d-flex justify-content-between my-3 ps-2">
        <Button
          variant="outline-success"
          className="fs-7 text-muted-hover-black"
          type="submit"
        >
          Save
        </Button>
        <Button onClick={onClose} variant="dark">
          Cancel
        </Button>
      </div>
      <div className="mt-4">
        <div className="mb-3 text-muted ps-2 fs-7">Markdown Preview</div>
        <div style={{ height: 400 }} className="bg-hdx-dark">
          <HDXMarkdownChart config={previewConfig} />
        </div>
      </div>
    </form>
  );
};

export const EditSearchChartForm = ({
  chart,
  onClose,
  onSave,
  dateRange,
}: {
  chart: Chart | undefined;
  dateRange: [Date, Date];
  onSave: (chart: Chart) => void;
  onClose: () => void;
}) => {
  const [editedChart, setEditedChart] = useState<Chart | undefined>(chart);

  const chartConfig = useMemo(() => {
    return editedChart != null && editedChart.series[0].type === 'search'
      ? {
          where: editedChart.series[0].where,
          dateRange,
        }
      : null;
  }, [editedChart, dateRange]);
  const previewConfig = useDebounce(chartConfig, 500);

  if (
    chartConfig == null ||
    editedChart == null ||
    previewConfig == null ||
    editedChart.series[0].type !== 'search'
  ) {
    return null;
  }

  const labelWidth = 320;

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSave(editedChart);
      }}
    >
      <div className="fs-5 mb-4">Search Builder</div>
      <div className="d-flex align-items-center mb-4">
        <Form.Control
          type="text"
          id="name"
          onChange={e =>
            setEditedChart(
              produce(editedChart, draft => {
                draft.name = e.target.value;
              }),
            )
          }
          defaultValue={editedChart.name}
          placeholder="Chart Name"
        />
      </div>
      <div className="d-flex mt-3 align-items-center">
        <div style={{ width: labelWidth }} className="text-muted fw-500 ps-2">
          Search Query
        </div>
        <div className="ms-3 flex-grow-1">
          <InputGroup>
            <Form.Control
              type="text"
              placeholder={'Filter results by a search query'}
              className="border-0 fs-7"
              value={editedChart.series[0].where}
              onChange={event =>
                setEditedChart(
                  produce(editedChart, draft => {
                    if (draft.series[0].type === 'search') {
                      draft.series[0].where = event.target.value;
                    }
                  }),
                )
              }
            />
          </InputGroup>
        </div>
      </div>
      <div className="d-flex justify-content-between my-3 ps-2">
        <Button
          variant="outline-success"
          className="fs-7 text-muted-hover-black"
          type="submit"
        >
          Save
        </Button>
        <Button onClick={onClose} variant="dark">
          Cancel
        </Button>
      </div>
      <div className="mt-4">
        <div className="mb-3 text-muted ps-2 fs-7">Search Preview</div>
        <div style={{ height: 400 }} className="bg-hdx-dark">
          <LogTableWithSidePanel
            config={{
              ...previewConfig,
              where: previewConfig.where,
            }}
            isLive={false}
            isUTC={false}
            setIsUTC={() => {}}
            onPropertySearchClick={() => {}}
          />
        </div>
      </div>
    </form>
  );
};

export const EditNumberChartForm = ({
  chart,
  onClose,
  onSave,
  dateRange,
}: {
  chart: Chart | undefined;
  dateRange: [Date, Date];
  onSave: (chart: Chart) => void;
  onClose: () => void;
}) => {
  const [editedChart, setEditedChart] = useState<Chart | undefined>(chart);

  const chartConfig = useMemo(() => {
    return editedChart != null && editedChart.series[0].type === 'number'
      ? {
          aggFn: editedChart.series[0].aggFn ?? 'count',
          table: editedChart.series[0].table ?? 'logs',
          field: editedChart.series[0].field ?? '', // TODO: Fix in definition
          where: editedChart.series[0].where,
          dateRange,
          numberFormat: editedChart.series[0].numberFormat,
        }
      : null;
  }, [editedChart, dateRange]);
  const previewConfig = useDebounce(chartConfig, 500);

  if (
    chartConfig == null ||
    editedChart == null ||
    previewConfig == null ||
    editedChart.series[0].type !== 'number'
  ) {
    return null;
  }

  const labelWidth = 320;
  const aggFn = editedChart.series[0].aggFn ?? 'count';

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSave(editedChart);
      }}
    >
      <div className="fs-5 mb-4">Number Tile Builder</div>
      <div className="d-flex align-items-center mb-4">
        <Form.Control
          type="text"
          id="name"
          onChange={e =>
            setEditedChart(
              produce(editedChart, draft => {
                draft.name = e.target.value;
              }),
            )
          }
          defaultValue={editedChart.name}
          placeholder="Chart Name"
        />
      </div>
      <div className="d-flex mt-3 align-items-center">
        <div style={{ width: labelWidth }} className="text-muted fw-500 ps-2">
          Aggregation Function
        </div>
        <div className="ms-3 flex-grow-1">
          <Select
            options={AGG_FNS}
            className="ds-select"
            value={AGG_FNS.find(v => v.value === aggFn)}
            onChange={opt => {
              setEditedChart(
                produce(editedChart, draft => {
                  if (draft.series[0].type === 'number') {
                    draft.series[0].aggFn = opt?.value ?? 'count';
                  }
                }),
              );
            }}
            classNamePrefix="ds-react-select"
          />
        </div>
      </div>
      {aggFn !== 'count' && (
        <div className="d-flex mt-3 align-items-center">
          <div style={{ width: labelWidth }} className="text-muted fw-500 ps-2">
            Field
          </div>
          <div className="ms-3 flex-grow-1">
            <FieldSelect
              value={editedChart.series[0].field ?? ''}
              setValue={field =>
                setEditedChart(
                  produce(editedChart, draft => {
                    if (draft.series[0].type === 'number') {
                      draft.series[0].field = field;
                    }
                  }),
                )
              }
              types={
                aggFn === 'count_distinct'
                  ? ['number', 'string', 'bool']
                  : ['number']
              }
            />
          </div>
        </div>
      )}
      <div className="d-flex mt-3 align-items-center">
        <div style={{ width: labelWidth }} className="text-muted fw-500 ps-2">
          Where
        </div>
        <div className="ms-3 flex-grow-1">
          <InputGroup>
            <Form.Control
              type="text"
              placeholder={'Filter results by a search query'}
              className="border-0 fs-7"
              value={editedChart.series[0].where}
              onChange={event =>
                setEditedChart(
                  produce(editedChart, draft => {
                    if (draft.series[0].type === 'number') {
                      draft.series[0].where = event.target.value;
                    }
                  }),
                )
              }
            />
          </InputGroup>
        </div>
      </div>
      <div className="ms-2 mt-2 mb-3">
        <Divider
          label={
            <>
              <i className="bi bi-gear me-1" />
              Chart Settings
            </>
          }
          c="dark.2"
          mb={8}
        />
        <Group>
          <div className="fs-8 text-slate-300">Number Format</div>
          <NumberFormatInput
            value={editedChart.series[0].numberFormat}
            onChange={numberFormat =>
              setEditedChart(
                produce(editedChart, draft => {
                  if (draft.series[0].type === 'number') {
                    draft.series[0].numberFormat = numberFormat;
                  }
                }),
              )
            }
          />
        </Group>
      </div>

      <div className="d-flex justify-content-between my-3 ps-2">
        <Button
          variant="outline-success"
          className="fs-7 text-muted-hover-black"
          type="submit"
        >
          Save
        </Button>
        <Button onClick={onClose} variant="dark">
          Cancel
        </Button>
      </div>
      <div className="mt-4">
        <div className="mb-3 text-muted ps-2 fs-7">Chart Preview</div>
        <div style={{ height: 400 }}>
          <HDXNumberChart config={previewConfig} />
        </div>
      </div>
      {editedChart.series[0].table === 'logs' ? (
        <>
          <div className="ps-2 mt-2 border-top border-dark">
            <div className="my-3 fs-7 fw-bold">Sample Matched Events</div>
            <div style={{ height: 150 }} className="bg-hdx-dark">
              <LogTableWithSidePanel
                config={{
                  ...previewConfig,
                  where: `${previewConfig.where} ${
                    previewConfig.field != '' ? `${previewConfig.field}:*` : ''
                  }`,
                }}
                isLive={false}
                isUTC={false}
                setIsUTC={() => {}}
                onPropertySearchClick={() => {}}
              />
            </div>
          </div>
        </>
      ) : null}
    </form>
  );
};

export const EditTableChartForm = ({
  chart,
  onClose,
  onSave,
  dateRange,
}: {
  chart: Chart | undefined;
  dateRange: [Date, Date];
  onSave: (chart: Chart) => void;
  onClose: () => void;
}) => {
  const CHART_TYPE = 'table';

  const [editedChart, setEditedChart] = useState<Chart | undefined>(chart);

  const chartConfig = useMemo(
    () =>
      editedChart != null && editedChart.series?.[0]?.type === CHART_TYPE
        ? {
            table: editedChart.series[0].table ?? 'logs',
            aggFn: editedChart.series[0].aggFn,
            field: editedChart.series[0].field ?? '', // TODO: Fix in definition
            groupBy: editedChart.series[0].groupBy[0],
            where: editedChart.series[0].where,
            sortOrder: editedChart.series[0].sortOrder ?? 'desc',
            granularity: convertDateRangeToGranularityString(dateRange, 60),
            dateRange,
            numberFormat: editedChart.series[0].numberFormat,
          }
        : null,
    [editedChart, dateRange],
  );
  const previewConfig = useDebounce(chartConfig, 500);

  if (
    chartConfig == null ||
    previewConfig == null ||
    editedChart == null ||
    editedChart.series[0].type !== CHART_TYPE
  ) {
    return null;
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSave(editedChart);
      }}
    >
      <div className="fs-5 mb-4">Table Builder</div>
      <div className="d-flex align-items-center mb-4">
        <Form.Control
          type="text"
          id="name"
          onChange={e =>
            setEditedChart(
              produce(editedChart, draft => {
                draft.name = e.target.value;
              }),
            )
          }
          defaultValue={editedChart.name}
          placeholder="Chart Name"
        />
      </div>
      <ChartSeriesForm
        sortOrder={editedChart.series[0].sortOrder ?? 'desc'}
        table={editedChart.series[0].table ?? 'logs'}
        aggFn={editedChart.series[0].aggFn}
        where={editedChart.series[0].where}
        groupBy={editedChart.series[0].groupBy[0]}
        field={editedChart.series[0].field ?? ''}
        setTable={table =>
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                draft.series[0].table = table;
              }
            }),
          )
        }
        setAggFn={aggFn =>
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                draft.series[0].aggFn = aggFn;
              }
            }),
          )
        }
        setTableAndAggFn={(table, aggFn) => {
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                draft.series[0].table = table;
                draft.series[0].aggFn = aggFn;
              }
            }),
          );
        }}
        setWhere={where =>
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                draft.series[0].where = where;
              }
            }),
          )
        }
        setGroupBy={groupBy =>
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                if (groupBy != undefined) {
                  draft.series[0].groupBy[0] = groupBy;
                } else {
                  draft.series[0].groupBy = [];
                }
              }
            }),
          )
        }
        setField={field =>
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                draft.series[0].field = field;
              }
            }),
          )
        }
        setFieldAndAggFn={(field, aggFn) => {
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                draft.series[0].field = field;
                draft.series[0].aggFn = aggFn;
              }
            }),
          );
        }}
        setSortOrder={sortOrder =>
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                draft.series[0].sortOrder = sortOrder;
              }
            }),
          )
        }
        numberFormat={editedChart.series[0].numberFormat}
        setNumberFormat={numberFormat =>
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                draft.series[0].numberFormat = numberFormat;
              }
            }),
          )
        }
      />
      <div className="d-flex justify-content-between my-3 ps-2">
        <Button
          variant="outline-success"
          className="fs-7 text-muted-hover-black"
          type="submit"
        >
          Save
        </Button>
        <Button onClick={onClose} variant="dark">
          Cancel
        </Button>
      </div>
      <div className="mt-4">
        <div className="mb-3 text-muted ps-2 fs-7">Chart Preview</div>
        <div style={{ height: 400 }}>
          <HDXTableChart config={previewConfig} />
        </div>
      </div>
      {editedChart.series[0].table === 'logs' ? (
        <>
          <div className="ps-2 mt-2 border-top border-dark">
            <div className="my-3 fs-7 fw-bold">Sample Matched Events</div>
            <div style={{ height: 150 }} className="bg-hdx-dark">
              <LogTableWithSidePanel
                config={{
                  ...previewConfig,
                  where: `${previewConfig.where} ${
                    previewConfig.aggFn != 'count' && previewConfig.field != ''
                      ? `${previewConfig.field}:*`
                      : ''
                  } ${
                    previewConfig.groupBy != '' && previewConfig.groupBy != null
                      ? `${previewConfig.groupBy}:*`
                      : ''
                  }`,
                }}
                isLive={false}
                isUTC={false}
                setIsUTC={() => {}}
                onPropertySearchClick={() => {}}
              />
            </div>
          </div>
        </>
      ) : null}
    </form>
  );
};

export const EditHistogramChartForm = ({
  chart,
  onClose,
  onSave,
  dateRange,
}: {
  chart: Chart | undefined;
  dateRange: [Date, Date];
  onSave: (chart: Chart) => void;
  onClose: () => void;
}) => {
  const [editedChart, setEditedChart] = useState<Chart | undefined>(chart);

  const chartConfig = useMemo(() => {
    return editedChart != null && editedChart.series[0].type === 'histogram'
      ? {
          table: editedChart.series[0].table ?? 'logs',
          field: editedChart.series[0].field ?? '', // TODO: Fix in definition
          where: editedChart.series[0].where,
          dateRange,
        }
      : null;
  }, [editedChart, dateRange]);
  const previewConfig = useDebounce(chartConfig, 500);

  if (
    chartConfig == null ||
    editedChart == null ||
    previewConfig == null ||
    editedChart.series[0].type !== 'histogram'
  ) {
    return null;
  }

  const labelWidth = 320;

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSave(editedChart);
      }}
    >
      <div className="fs-5 mb-4">Histogram Builder</div>
      <div className="d-flex align-items-center mb-4">
        <Form.Control
          type="text"
          id="name"
          onChange={e =>
            setEditedChart(
              produce(editedChart, draft => {
                draft.name = e.target.value;
              }),
            )
          }
          defaultValue={editedChart.name}
          placeholder="Chart Name"
        />
      </div>
      <div className="d-flex mt-3 align-items-center">
        <div style={{ width: labelWidth }} className="text-muted fw-500 ps-2">
          Field
        </div>
        <div className="ms-3 flex-grow-1">
          <FieldSelect
            value={editedChart.series[0].field ?? ''}
            setValue={field =>
              setEditedChart(
                produce(editedChart, draft => {
                  if (draft.series[0].type === 'histogram') {
                    draft.series[0].field = field;
                  }
                }),
              )
            }
            types={['number']}
          />
        </div>
      </div>
      <div className="d-flex mt-3 align-items-center">
        <div style={{ width: labelWidth }} className="text-muted fw-500 ps-2">
          Where
        </div>
        <div className="ms-3 flex-grow-1">
          <InputGroup>
            <Form.Control
              type="text"
              placeholder={'Filter results by a search query'}
              className="border-0 fs-7"
              value={editedChart.series[0].where}
              onChange={event =>
                setEditedChart(
                  produce(editedChart, draft => {
                    if (draft.series[0].type === 'histogram') {
                      draft.series[0].where = event.target.value;
                    }
                  }),
                )
              }
            />
          </InputGroup>
        </div>
      </div>
      <div className="d-flex justify-content-between my-3 ps-2">
        <Button
          variant="outline-success"
          className="fs-7 text-muted-hover-black"
          type="submit"
        >
          Save
        </Button>
        <Button onClick={onClose} variant="dark">
          Cancel
        </Button>
      </div>
      <div className="mt-4">
        <div className="mb-3 text-muted ps-2 fs-7">Chart Preview</div>
        <div style={{ height: 400 }}>
          <HDXHistogramChart config={previewConfig} />
        </div>
      </div>
      {editedChart.series[0].table === 'logs' ? (
        <>
          <div className="ps-2 mt-2 border-top border-dark">
            <div className="my-3 fs-7 fw-bold">Sample Matched Events</div>
            <div style={{ height: 150 }} className="bg-hdx-dark">
              <LogTableWithSidePanel
                config={{
                  ...previewConfig,
                  where: `${previewConfig.where} ${
                    previewConfig.field != '' ? `${previewConfig.field}:*` : ''
                  }`,
                }}
                isLive={false}
                isUTC={false}
                setIsUTC={() => {}}
                onPropertySearchClick={() => {}}
              />
            </div>
          </div>
        </>
      ) : null}
    </form>
  );
};

export const EditLineChartForm = ({
  isLocalDashboard,
  chart,
  alerts,
  onClose,
  onSave,
  dateRange,
}: {
  isLocalDashboard: boolean;
  chart: Chart | undefined;
  alerts: Alert[];
  dateRange: [Date, Date];
  onSave: (chart: Chart, alerts?: Alert[]) => void;
  onClose: () => void;
}) => {
  const CHART_TYPE = 'time';
  const [alert] = alerts; // TODO: Support multiple alerts eventually
  const [editedChart, setEditedChart] = useState<Chart | undefined>(chart);
  const [editedAlert, setEditedAlert] = useState<Alert | undefined>(alert);
  const [alertEnabled, setAlertEnabled] = useState(editedAlert != null);

  const chartConfig = useMemo(
    () =>
      editedChart != null && editedChart.series?.[0]?.type === CHART_TYPE
        ? {
            table: editedChart.series[0].table ?? 'logs',
            aggFn: editedChart.series[0].aggFn,
            field: editedChart.series[0].field ?? '', // TODO: Fix in definition
            groupBy: editedChart.series[0].groupBy[0],
            where: editedChart.series[0].where,
            granularity:
              alertEnabled && editedAlert?.interval
                ? intervalToGranularity(editedAlert?.interval)
                : convertDateRangeToGranularityString(dateRange, 60),
            dateRange,
            numberFormat: editedChart.series[0].numberFormat,
          }
        : null,
    [editedChart, alertEnabled, editedAlert?.interval, dateRange],
  );
  const previewConfig = useDebounce(chartConfig, 500);

  if (
    chartConfig == null ||
    previewConfig == null ||
    editedChart == null ||
    editedChart.series[0].type !== 'time'
  ) {
    return null;
  }

  const isChartAlertsFeatureEnabled =
    editedChart.series[0].table === 'logs' || METRIC_ALERTS_ENABLED;

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSave(
          editedChart,
          alertEnabled ? [editedAlert ?? DEFAULT_ALERT] : undefined,
        );
      }}
    >
      <div className="fs-5 mb-4">Line Chart Builder</div>
      <div className="d-flex align-items-center mb-4">
        <Form.Control
          type="text"
          id="name"
          onChange={e =>
            setEditedChart(
              produce(editedChart, draft => {
                draft.name = e.target.value;
              }),
            )
          }
          defaultValue={editedChart.name}
          placeholder="Chart Name"
        />
      </div>
      <ChartSeriesForm
        table={editedChart.series[0].table ?? 'logs'}
        aggFn={editedChart.series[0].aggFn}
        where={editedChart.series[0].where}
        groupBy={editedChart.series[0].groupBy[0]}
        field={editedChart.series[0].field ?? ''}
        numberFormat={editedChart.series[0].numberFormat}
        setTable={table =>
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                draft.series[0].table = table;
              }
            }),
          )
        }
        setAggFn={aggFn =>
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                draft.series[0].aggFn = aggFn;
              }
            }),
          )
        }
        setWhere={where =>
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                draft.series[0].where = where;
              }
            }),
          )
        }
        setGroupBy={groupBy =>
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                if (groupBy != undefined) {
                  draft.series[0].groupBy[0] = groupBy;
                } else {
                  draft.series[0].groupBy = [];
                }
              }
            }),
          )
        }
        setField={field =>
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                draft.series[0].field = field;
              }
            }),
          )
        }
        setTableAndAggFn={(table, aggFn) => {
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                draft.series[0].table = table;
                draft.series[0].aggFn = aggFn;
              }
            }),
          );
        }}
        setFieldAndAggFn={(field, aggFn) => {
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                draft.series[0].field = field;
                draft.series[0].aggFn = aggFn;
              }
            }),
          );
        }}
        setNumberFormat={numberFormat =>
          setEditedChart(
            produce(editedChart, draft => {
              if (draft.series[0].type === CHART_TYPE) {
                draft.series[0].numberFormat = numberFormat;
              }
            }),
          )
        }
      />

      {isChartAlertsFeatureEnabled && (
        <Paper bg="dark.7" p="md" py="xs" mt="md" withBorder className="ms-2">
          {isLocalDashboard ? (
            <span className="text-gray-600 fs-8">
              Alerts are not available in unsaved dashboards.
            </span>
          ) : (
            <>
              <Checkbox
                id="check"
                label="Enable alerts"
                checked={alertEnabled}
                onChange={() => setAlertEnabled(!alertEnabled)}
              />
              {alertEnabled && (
                <div className="mt-2">
                  <Divider mb="sm" />
                  <EditChartFormAlerts
                    alert={editedAlert ?? DEFAULT_ALERT}
                    setAlert={setEditedAlert}
                    numberFormat={editedChart.series[0].numberFormat}
                  />
                </div>
              )}
            </>
          )}
        </Paper>
      )}

      <div className="d-flex justify-content-between my-3 ps-2">
        <Button
          variant="outline-success"
          className="fs-7 text-muted-hover-black"
          type="submit"
        >
          Save
        </Button>
        <Button onClick={onClose} variant="dark">
          Cancel
        </Button>
      </div>
      <div className="mt-4">
        <div className="mb-3 text-muted ps-2 fs-7">Chart Preview</div>
        <div style={{ height: 400 }}>
          <HDXLineChart
            config={previewConfig}
            {...(alertEnabled && {
              alertThreshold: editedAlert?.threshold,
              alertThresholdType:
                editedAlert?.type === 'presence' ? 'above' : 'below',
            })}
          />
        </div>
      </div>
      {editedChart.series[0].table === 'logs' ? (
        <>
          <div className="ps-2 mt-2 border-top border-dark">
            <div className="my-3 fs-7 fw-bold">Sample Matched Events</div>
            <div style={{ height: 150 }} className="bg-hdx-dark">
              <LogTableWithSidePanel
                config={{
                  ...previewConfig,
                  where: `${previewConfig.where} ${
                    previewConfig.aggFn != 'count' && previewConfig.field != ''
                      ? `${previewConfig.field}:*`
                      : ''
                  } ${
                    previewConfig.groupBy != '' && previewConfig.groupBy != null
                      ? `${previewConfig.groupBy}:*`
                      : ''
                  }`,
                }}
                isLive={false}
                isUTC={false}
                setIsUTC={() => {}}
                onPropertySearchClick={() => {}}
              />
            </div>
          </div>
        </>
      ) : null}
    </form>
  );
};
