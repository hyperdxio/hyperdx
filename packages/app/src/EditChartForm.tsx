import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Draft } from 'immer';
import produce from 'immer';
import { Button as BSButton, Form, InputGroup } from 'react-bootstrap';
import Select from 'react-select';
import { Button, Divider, Flex, Group, Paper, Switch } from '@mantine/core';

import { NumberFormatInput } from './components/NumberFormat';
import { intervalToGranularity } from './Alert';
import {
  AGG_FNS,
  ChartSeriesFormCompact,
  convertDateRangeToGranularityString,
  FieldSelect,
  Granularity,
  GroupBySelect,
  seriesToSearchQuery,
  TableSelect,
} from './ChartUtils';
import Checkbox from './Checkbox';
import * as config from './config';
import { METRIC_ALERTS_ENABLED } from './config';
import EditChartFormAlerts from './EditChartFormAlerts';
import GranularityPicker from './GranularityPicker';
import HDXHistogramChart from './HDXHistogramChart';
import HDXMarkdownChart from './HDXMarkdownChart';
import HDXMultiSeriesTableChart from './HDXMultiSeriesTableChart';
import HDXMultiSeriesTimeChart from './HDXMultiSeriesTimeChart';
import HDXNumberChart from './HDXNumberChart';
import { LogTableWithSidePanel } from './LogTableWithSidePanel';
import SearchTimeRangePicker from './SearchTimeRangePicker';
import type { Alert, Chart, ChartSeries, TimeChartSeries } from './types';
import { useDebounce } from './utils';

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
  onSave?: (chart: Chart) => void;
  onClose?: () => void;
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
        onSave?.(editedChart);
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
      {(onSave != null || onClose != null) && (
        <div className="d-flex justify-content-between my-3 ps-2">
          {onSave != null && (
            <BSButton
              variant="outline-success"
              className="fs-7 text-muted-hover-black"
              type="submit"
            >
              Save
            </BSButton>
          )}
          {onClose != null && (
            <BSButton onClick={onClose} variant="dark">
              Cancel
            </BSButton>
          )}
        </div>
      )}
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
  onSave?: (chart: Chart) => void;
  onClose?: () => void;
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
        onSave?.(editedChart);
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
      {(onSave != null || onClose != null) && (
        <div className="d-flex justify-content-between my-3 ps-2">
          {onSave != null && (
            <BSButton
              variant="outline-success"
              className="fs-7 text-muted-hover-black"
              type="submit"
            >
              Save
            </BSButton>
          )}
          {onClose != null && (
            <BSButton onClick={onClose} variant="dark">
              Cancel
            </BSButton>
          )}
        </div>
      )}
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
  editedChart,
  setEditedChart,
  displayedTimeInputValue,
  setDisplayedTimeInputValue,
  onTimeRangeSearch,
}: {
  chart: Chart | undefined;
  dateRange: [Date, Date];
  onSave?: (chart: Chart) => void;
  onClose?: () => void;
  displayedTimeInputValue?: string;
  setDisplayedTimeInputValue?: (value: string) => void;
  onTimeRangeSearch?: (value: string) => void;
  editedChart?: Chart;
  setEditedChart?: (chart: Chart) => void;
}) => {
  const [editedChartState, setEditedChartState] = useState<Chart | undefined>(
    chart,
  );
  const [_editedChart, _setEditedChart] =
    editedChart != null && setEditedChart != null
      ? [editedChart, setEditedChart]
      : [editedChartState, setEditedChartState];

  const chartConfig = useMemo(() => {
    return _editedChart != null && _editedChart.series[0].type === 'number'
      ? {
          aggFn: _editedChart.series[0].aggFn ?? 'count',
          table: _editedChart.series[0].table ?? 'logs',
          field: _editedChart.series[0].field ?? '', // TODO: Fix in definition
          where: _editedChart.series[0].where,
          dateRange,
          numberFormat: _editedChart.series[0].numberFormat,
        }
      : null;
  }, [_editedChart, dateRange]);
  const previewConfig = useDebounce(chartConfig, 500);

  if (
    chartConfig == null ||
    _editedChart == null ||
    previewConfig == null ||
    _editedChart.series[0].type !== 'number'
  ) {
    return null;
  }

  const labelWidth = 320;
  const aggFn = _editedChart.series[0].aggFn ?? 'count';

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSave?.(_editedChart);
      }}
    >
      <div className="fs-5 mb-4">Number Tile Builder</div>
      <div className="d-flex align-items-center mb-4">
        <Form.Control
          type="text"
          id="name"
          onChange={e =>
            _setEditedChart(
              produce(_editedChart, draft => {
                draft.name = e.target.value;
              }),
            )
          }
          defaultValue={_editedChart.name}
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
              _setEditedChart(
                produce(_editedChart, draft => {
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
              value={_editedChart.series[0].field ?? ''}
              setValue={field =>
                _setEditedChart(
                  produce(_editedChart, draft => {
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
              value={_editedChart.series[0].where}
              onChange={event =>
                _setEditedChart(
                  produce(_editedChart, draft => {
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
            value={_editedChart.series[0].numberFormat}
            onChange={numberFormat =>
              _setEditedChart(
                produce(_editedChart, draft => {
                  if (draft.series[0].type === 'number') {
                    draft.series[0].numberFormat = numberFormat;
                  }
                }),
              )
            }
          />
        </Group>
      </div>
      {(onSave != null || onClose != null) && (
        <div className="d-flex justify-content-between my-3 ps-2">
          {onSave != null && (
            <BSButton
              variant="outline-success"
              className="fs-7 text-muted-hover-black"
              type="submit"
            >
              Save
            </BSButton>
          )}
          {onClose != null && (
            <BSButton onClick={onClose} variant="dark">
              Cancel
            </BSButton>
          )}
        </div>
      )}
      <div className="mt-4">
        <Flex justify="space-between" align="center" mb="sm">
          <div className="text-muted ps-2 fs-7" style={{ flexGrow: 1 }}>
            Chart Preview
          </div>
          {setDisplayedTimeInputValue != null &&
            displayedTimeInputValue != null &&
            onTimeRangeSearch != null && (
              <div className="ms-3 flex-grow-1" style={{ maxWidth: 360 }}>
                <SearchTimeRangePicker
                  inputValue={displayedTimeInputValue}
                  setInputValue={setDisplayedTimeInputValue}
                  onSearch={range => {
                    onTimeRangeSearch(range);
                  }}
                />
              </div>
            )}
        </Flex>
        <div style={{ height: 400 }}>
          <HDXNumberChart config={previewConfig} />
        </div>
      </div>
      {_editedChart.series[0].table === 'logs' ? (
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
  displayedTimeInputValue,
  setDisplayedTimeInputValue,
  onTimeRangeSearch,
  editedChart,
  setEditedChart,
}: {
  chart: Chart | undefined;
  dateRange: [Date, Date];
  onSave?: (chart: Chart) => void;
  onClose?: () => void;
  editedChart?: Chart;
  setEditedChart?: (chart: Chart) => void;
  displayedTimeInputValue?: string;
  setDisplayedTimeInputValue?: (value: string) => void;
  onTimeRangeSearch?: (value: string) => void;
}) => {
  const CHART_TYPE = 'table';

  const [editedChartState, setEditedChartState] = useState<Chart | undefined>(
    chart,
  );
  const [_editedChart, _setEditedChart] =
    editedChart != null && setEditedChart != null
      ? [editedChart, setEditedChart]
      : [editedChartState, setEditedChartState];

  const chartConfig = useMemo(
    () =>
      _editedChart != null && _editedChart.series?.[0]?.type === CHART_TYPE
        ? {
            table: _editedChart.series[0].table ?? 'logs',
            aggFn: _editedChart.series[0].aggFn,
            field: _editedChart.series[0].field ?? '', // TODO: Fix in definition
            groupBy: _editedChart.series[0].groupBy[0],
            where: _editedChart.series[0].where,
            sortOrder: _editedChart.series[0].sortOrder ?? 'desc',
            granularity: convertDateRangeToGranularityString(dateRange, 60),
            dateRange,
            numberFormat: _editedChart.series[0].numberFormat,
            series: _editedChart.series,
            seriesReturnType: _editedChart.seriesReturnType,
          }
        : null,
    [_editedChart, dateRange],
  );
  const previewConfig = useDebounce(chartConfig, 500);

  if (
    chartConfig == null ||
    previewConfig == null ||
    _editedChart == null ||
    _editedChart.series[0].type !== CHART_TYPE
  ) {
    return null;
  }

  return (
    <form
      className="flex-grow-1 d-flex flex-column"
      onSubmit={e => {
        e.preventDefault();
        onSave?.(_editedChart);
      }}
    >
      <div className="fs-5 mb-4">Table Builder</div>
      <div className="d-flex align-items-center mb-4">
        <Form.Control
          type="text"
          id="name"
          onChange={e =>
            _setEditedChart(
              produce(_editedChart, draft => {
                draft.name = e.target.value;
              }),
            )
          }
          defaultValue={_editedChart.name}
          placeholder="Chart Name"
        />
      </div>
      <EditMultiSeriesChartForm
        {...{
          editedChart: _editedChart,
          setEditedChart: _setEditedChart,
          CHART_TYPE,
        }}
      />
      {(onSave != null || onClose != null) && (
        <div className="d-flex justify-content-between my-3 ps-2">
          {onSave != null && (
            <BSButton
              variant="outline-success"
              className="fs-7 text-muted-hover-black"
              type="submit"
            >
              Save
            </BSButton>
          )}
          {onClose != null && (
            <BSButton onClick={onClose} variant="dark">
              Cancel
            </BSButton>
          )}
        </div>
      )}
      <Flex justify="space-between" align="center" mb="sm">
        <div className="text-muted ps-2 fs-7" style={{ flexGrow: 1 }}>
          Chart Preview
        </div>
        {setDisplayedTimeInputValue != null &&
          displayedTimeInputValue != null &&
          onTimeRangeSearch != null && (
            <div className="ms-3 flex-grow-1" style={{ maxWidth: 360 }}>
              <SearchTimeRangePicker
                inputValue={displayedTimeInputValue}
                setInputValue={setDisplayedTimeInputValue}
                onSearch={range => {
                  onTimeRangeSearch(range);
                }}
              />
            </div>
          )}
      </Flex>
      <div
        style={{ minHeight: 400 }}
        className="d-flex flex-column flex-grow-1"
      >
        <HDXMultiSeriesTableChart
          config={previewConfig}
          onSortClick={seriesIndex => {
            _setEditedChart(
              produce(_editedChart, draft => {
                // We need to clear out all other series sort orders first
                for (let i = 0; i < draft.series.length; i++) {
                  if (i !== seriesIndex) {
                    const s = draft.series[i];
                    if (s.type === CHART_TYPE) {
                      s.sortOrder = undefined;
                    }
                  }
                }

                const s = draft.series[seriesIndex];
                if (s.type === CHART_TYPE) {
                  s.sortOrder =
                    s.sortOrder == null
                      ? 'desc'
                      : s.sortOrder === 'asc'
                      ? 'desc'
                      : 'asc';
                }

                return;
              }),
            );
          }}
        />
      </div>
      {_editedChart.series[0].table === 'logs' ? (
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
  displayedTimeInputValue,
  setDisplayedTimeInputValue,
  onTimeRangeSearch,
  editedChart,
  setEditedChart,
}: {
  chart: Chart | undefined;
  dateRange: [Date, Date];
  onSave?: (chart: Chart) => void;
  onClose?: () => void;
  editedChart?: Chart;
  setEditedChart?: (chart: Chart) => void;
  displayedTimeInputValue?: string;
  setDisplayedTimeInputValue?: (value: string) => void;
  onTimeRangeSearch?: (value: string) => void;
}) => {
  const [editedChartState, setEditedChartState] = useState<Chart | undefined>(
    chart,
  );
  const [_editedChart, _setEditedChart] =
    editedChart != null && setEditedChart != null
      ? [editedChart, setEditedChart]
      : [editedChartState, setEditedChartState];

  const chartConfig = useMemo(() => {
    return _editedChart != null && _editedChart.series[0].type === 'histogram'
      ? {
          table: _editedChart.series[0].table ?? 'logs',
          field: _editedChart.series[0].field ?? '', // TODO: Fix in definition
          where: _editedChart.series[0].where,
          dateRange,
        }
      : null;
  }, [_editedChart, dateRange]);
  const previewConfig = useDebounce(chartConfig, 500);

  if (
    chartConfig == null ||
    _editedChart == null ||
    previewConfig == null ||
    _editedChart.series[0].type !== 'histogram'
  ) {
    return null;
  }

  const labelWidth = 320;

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSave?.(_editedChart);
      }}
    >
      <div className="fs-5 mb-4">Histogram Builder</div>
      <div className="d-flex align-items-center mb-4">
        <Form.Control
          type="text"
          id="name"
          onChange={e =>
            _setEditedChart(
              produce(_editedChart, draft => {
                draft.name = e.target.value;
              }),
            )
          }
          defaultValue={_editedChart.name}
          placeholder="Chart Name"
        />
      </div>
      <div className="d-flex mt-3 align-items-center">
        <div style={{ width: labelWidth }} className="text-muted fw-500 ps-2">
          Field
        </div>
        <div className="ms-3 flex-grow-1">
          <FieldSelect
            value={_editedChart.series[0].field ?? ''}
            setValue={field =>
              _setEditedChart(
                produce(_editedChart, draft => {
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
              value={_editedChart.series[0].where}
              onChange={event =>
                _setEditedChart(
                  produce(_editedChart, draft => {
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
      {(onSave != null || onClose != null) && (
        <div className="d-flex justify-content-between my-3 ps-2">
          {onSave != null && (
            <BSButton
              variant="outline-success"
              className="fs-7 text-muted-hover-black"
              type="submit"
            >
              Save
            </BSButton>
          )}
          {onClose != null && (
            <BSButton onClick={onClose} variant="dark">
              Cancel
            </BSButton>
          )}
        </div>
      )}
      <div className="mt-4">
        <Flex justify="space-between" align="center" mb="sm">
          <div className="text-muted ps-2 fs-7" style={{ flexGrow: 1 }}>
            Chart Preview
          </div>
          {setDisplayedTimeInputValue != null &&
            displayedTimeInputValue != null &&
            onTimeRangeSearch != null && (
              <div className="ms-3 flex-grow-1" style={{ maxWidth: 360 }}>
                <SearchTimeRangePicker
                  inputValue={displayedTimeInputValue}
                  setInputValue={setDisplayedTimeInputValue}
                  onSearch={range => {
                    onTimeRangeSearch(range);
                  }}
                />
              </div>
            )}
        </Flex>
        <div style={{ height: 400 }}>
          <HDXHistogramChart config={previewConfig} />
        </div>
      </div>
      {_editedChart.series[0].table === 'logs' ? (
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

function pushNewSeries(draft: Draft<Chart>) {
  const firstSeries = draft.series[0] as TimeChartSeries;
  const { table, type, groupBy, numberFormat } = firstSeries;
  draft.series.push({
    table,
    type,
    aggFn: table === 'logs' ? 'count' : 'avg',
    field: '',
    where: '',
    groupBy,
    numberFormat,
  });
}

export const EditMultiSeriesChartForm = ({
  editedChart,
  setEditedChart,
  CHART_TYPE,
}: {
  editedChart: Chart;
  setEditedChart: (chart: Chart) => void;
  CHART_TYPE: 'time' | 'table';
}) => {
  if (editedChart.series[0].type !== CHART_TYPE) {
    return null;
  }

  return (
    <>
      {editedChart.series.length > 1 && (
        <Flex align="center" gap="md" mb="sm">
          <div className="text-muted">
            <i className="bi bi-database me-2" />
            Data Source
          </div>
          <div className="flex-grow-1">
            <TableSelect
              table={editedChart.series[0].table ?? 'logs'}
              setTableAndAggFn={(table, aggFn) => {
                setEditedChart(
                  produce(editedChart, draft => {
                    draft.series.forEach((series, i) => {
                      if (series.type === CHART_TYPE) {
                        series.table = table;
                        series.aggFn = aggFn;
                      }
                    });
                  }),
                );
              }}
            />
          </div>
        </Flex>
      )}
      {editedChart.series.map((series, i) => {
        if (series.type !== CHART_TYPE) {
          return null;
        }

        return (
          <div className="mb-2" key={i}>
            <Divider
              label={
                <>
                  {editedChart.series.length > 1 && (
                    <Button
                      variant="subtle"
                      color="gray"
                      size="xs"
                      onClick={() => {
                        setEditedChart(
                          produce(editedChart, draft => {
                            draft.series.splice(i, 1);
                            if (draft.series.length != 2) {
                              draft.seriesReturnType = 'column';
                            }
                          }),
                        );
                      }}
                    >
                      <i className="bi bi-trash me-2" />
                      Remove Series
                    </Button>
                  )}
                </>
              }
              c="dark.2"
              labelPosition="right"
              mb={8}
            />
            <ChartSeriesFormCompact
              table={series.table ?? 'logs'}
              aggFn={series.aggFn}
              where={series.where}
              groupBy={series.groupBy[0]}
              field={series.field ?? ''}
              numberFormat={series.numberFormat}
              setAggFn={aggFn =>
                setEditedChart(
                  produce(editedChart, draft => {
                    const draftSeries = draft.series[i];
                    if (draftSeries.type === CHART_TYPE) {
                      draftSeries.aggFn = aggFn;
                    }
                  }),
                )
              }
              setWhere={where =>
                setEditedChart(
                  produce(editedChart, draft => {
                    const draftSeries = draft.series[i];
                    if (draftSeries.type === CHART_TYPE) {
                      draftSeries.where = where;
                    }
                  }),
                )
              }
              setGroupBy={
                editedChart.series.length === 1
                  ? groupBy =>
                      setEditedChart(
                        produce(editedChart, draft => {
                          const draftSeries = draft.series[i];
                          if (draftSeries.type === CHART_TYPE) {
                            if (groupBy != undefined) {
                              draftSeries.groupBy[0] = groupBy;
                            } else {
                              draftSeries.groupBy = [];
                            }
                          }
                        }),
                      )
                  : undefined
              }
              setField={field =>
                setEditedChart(
                  produce(editedChart, draft => {
                    const draftSeries = draft.series[i];
                    if (draftSeries.type === CHART_TYPE) {
                      draftSeries.field = field;
                    }
                  }),
                )
              }
              setTableAndAggFn={
                editedChart.series.length === 1
                  ? (table, aggFn) => {
                      setEditedChart(
                        produce(editedChart, draft => {
                          const draftSeries = draft.series[i];
                          if (draftSeries.type === CHART_TYPE) {
                            draftSeries.table = table;
                            draftSeries.aggFn = aggFn;
                          }
                        }),
                      );
                    }
                  : undefined
              }
              setFieldAndAggFn={(field, aggFn) => {
                setEditedChart(
                  produce(editedChart, draft => {
                    const draftSeries = draft.series[i];
                    if (draftSeries.type === CHART_TYPE) {
                      draftSeries.field = field;
                      draftSeries.aggFn = aggFn;
                    }
                  }),
                );
              }}
            />
          </div>
        );
      })}
      <Divider my="md" />
      {editedChart.series.length > 1 && (
        <Flex align="center" gap="md" mb="sm">
          <div className="text-muted">Group By</div>
          <div className="flex-grow-1">
            <GroupBySelect
              table={editedChart.series[0].table ?? 'logs'}
              groupBy={editedChart.series[0].groupBy[0]}
              fields={
                editedChart.series
                  .map(s => (s as TimeChartSeries).field)
                  .filter(f => f != null) as string[]
              }
              setGroupBy={groupBy => {
                setEditedChart(
                  produce(editedChart, draft => {
                    draft.series.forEach((series, i) => {
                      if (series.type === CHART_TYPE) {
                        if (groupBy != undefined) {
                          series.groupBy[0] = groupBy;
                        } else {
                          series.groupBy = [];
                        }
                      }
                    });
                  }),
                );
              }}
            />
          </div>
        </Flex>
      )}
      <Flex justify="space-between">
        <Flex gap="md" align="center">
          {editedChart.series.length === 1 && (
            <Button
              mt={4}
              variant="subtle"
              size="sm"
              color="gray"
              onClick={() => {
                setEditedChart(
                  produce(editedChart, draft => {
                    pushNewSeries(draft);
                    draft.seriesReturnType = 'ratio';
                  }),
                );
              }}
            >
              <i className="bi bi-plus-circle me-2" />
              Add Ratio
            </Button>
          )}
          <Button
            mt={4}
            variant="subtle"
            size="sm"
            color="gray"
            onClick={() => {
              setEditedChart(
                produce(editedChart, draft => {
                  pushNewSeries(draft);
                  draft.seriesReturnType = 'column';
                }),
              );
            }}
          >
            <i className="bi bi-plus-circle me-2" />
            Add Series
          </Button>
          {editedChart.series.length == 2 && (
            <Switch
              label="As Ratio"
              checked={editedChart.seriesReturnType === 'ratio'}
              onChange={event =>
                setEditedChart(
                  produce(editedChart, draft => {
                    draft.seriesReturnType = event.currentTarget.checked
                      ? 'ratio'
                      : 'column';
                  }),
                )
              }
            />
          )}
        </Flex>
        <NumberFormatInput
          value={editedChart.series[0].numberFormat}
          onChange={numberFormat => {
            setEditedChart(
              produce(editedChart, draft => {
                draft.series.forEach((series, i) => {
                  if (series.type === CHART_TYPE) {
                    series.numberFormat = numberFormat;
                  }
                });
              }),
            );
          }}
        />
      </Flex>
    </>
  );
};

export const EditLineChartForm = ({
  isLocalDashboard,
  chart,
  alerts,
  onClose,
  onSave,
  dateRange,
  editedChart,
  setEditedChart,
  granularity,
  setGranularity,
  setDisplayedTimeInputValue,
  displayedTimeInputValue,
  onTimeRangeSearch,
}: {
  isLocalDashboard: boolean;
  chart: Chart | undefined;
  alerts?: Alert[];
  dateRange: [Date, Date];
  onSave?: (chart: Chart, alerts?: Alert[]) => void;
  onClose?: () => void;
  editedChart?: Chart;
  setEditedChart?: (chart: Chart) => void;
  displayedTimeInputValue?: string;
  setDisplayedTimeInputValue?: (value: string) => void;
  onTimeRangeSearch?: (value: string) => void;
  granularity?: Granularity | undefined;
  setGranularity?: (granularity: Granularity | undefined) => void;
}) => {
  const CHART_TYPE = 'time';
  const [alert] = alerts ?? []; // TODO: Support multiple alerts eventually
  const [editedChartState, setEditedChartState] = useState<Chart | undefined>(
    chart,
  );
  const [editedAlert, setEditedAlert] = useState<Alert | undefined>(alert);
  const [alertEnabled, setAlertEnabled] = useState(editedAlert != null);

  const [_editedChart, _setEditedChart] =
    editedChart != null && setEditedChart != null
      ? [editedChart, setEditedChart]
      : [editedChartState, setEditedChartState];

  const chartConfig = useMemo(
    () =>
      _editedChart != null && _editedChart.series?.[0]?.type === CHART_TYPE
        ? {
            table: _editedChart.series[0].table ?? 'logs',
            aggFn: _editedChart.series[0].aggFn,
            field: _editedChart.series[0].field ?? '', // TODO: Fix in definition
            groupBy: _editedChart.series[0].groupBy[0],
            where: _editedChart.series[0].where,
            granularity:
              alertEnabled && editedAlert?.interval
                ? intervalToGranularity(editedAlert?.interval)
                : granularity ??
                  convertDateRangeToGranularityString(dateRange, 60),
            dateRange,
            numberFormat: _editedChart.series[0].numberFormat,
            series: _editedChart.series,
            seriesReturnType: _editedChart.seriesReturnType,
          }
        : null,
    [_editedChart, alertEnabled, editedAlert?.interval, dateRange, granularity],
  );
  const previewConfig = useDebounce(chartConfig, 500);

  if (
    chartConfig == null ||
    previewConfig == null ||
    _editedChart == null ||
    _editedChart.series[0].type !== 'time'
  ) {
    return null;
  }

  const isChartAlertsFeatureEnabled =
    alerts != null &&
    (_editedChart.series[0].table === 'logs' || METRIC_ALERTS_ENABLED);

  return (
    <form
      className="d-flex flex-column flex-grow-1"
      onSubmit={e => {
        e.preventDefault();
        onSave?.(
          _editedChart,
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
            _setEditedChart(
              produce(_editedChart, draft => {
                draft.name = e.target.value;
              }),
            )
          }
          defaultValue={_editedChart.name}
          placeholder="Chart Name"
        />
      </div>
      <EditMultiSeriesChartForm
        {...{
          editedChart: _editedChart,
          setEditedChart: _setEditedChart,
          CHART_TYPE,
        }}
      />

      {isChartAlertsFeatureEnabled && (
        <Paper bg="dark.7" p="md" py="xs" mt="md" withBorder>
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
                    numberFormat={_editedChart.series[0].numberFormat}
                  />
                </div>
              )}
            </>
          )}
        </Paper>
      )}

      {(onSave != null || onClose != null) && (
        <div className="d-flex justify-content-between my-3">
          {onSave != null && (
            <BSButton
              variant="outline-success"
              className="fs-7 text-muted-hover-black"
              type="submit"
            >
              Save
            </BSButton>
          )}
          {onClose != null && (
            <BSButton onClick={onClose} variant="dark">
              Cancel
            </BSButton>
          )}
        </div>
      )}
      <Flex justify="space-between" align="center" my="sm">
        <div className="text-muted ps-2 fs-7" style={{ flexGrow: 1 }}>
          Chart Preview
        </div>
        <Flex align="center" style={{ marginLeft: 'auto', width: 600 }}>
          {setDisplayedTimeInputValue != null &&
            displayedTimeInputValue != null &&
            onTimeRangeSearch != null && (
              <div className="ms-3 flex-grow-1" style={{ maxWidth: 420 }}>
                <SearchTimeRangePicker
                  inputValue={displayedTimeInputValue}
                  setInputValue={setDisplayedTimeInputValue}
                  onSearch={range => {
                    onTimeRangeSearch(range);
                  }}
                />
              </div>
            )}
          {setGranularity != null && (
            <div className="ms-3" style={{ maxWidth: 360 }}>
              <GranularityPicker
                value={granularity}
                onChange={setGranularity}
              />
            </div>
          )}
        </Flex>
      </Flex>

      <div
        className="flex-grow-1 d-flex flex-column"
        style={{ minHeight: 400 }}
      >
        <HDXMultiSeriesTimeChart
          config={previewConfig}
          {...(alertEnabled && {
            alertThreshold: editedAlert?.threshold,
            alertThresholdType:
              editedAlert?.type === 'presence' ? 'above' : 'below',
          })}
        />
      </div>
      {_editedChart.series[0].table === 'logs' ? (
        <>
          <div className="ps-2 mt-2 border-top border-dark">
            <div className="my-3 fs-7 fw-bold">Sample Matched Events</div>
            <div style={{ height: 150 }} className="bg-hdx-dark">
              <LogTableWithSidePanel
                config={{
                  ...previewConfig,
                  where: `${seriesToSearchQuery({
                    series: previewConfig.series,
                  })}`,
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
