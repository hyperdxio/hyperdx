import { useCallback, useState } from 'react';
import produce from 'immer';

import { Granularity } from './ChartUtils';
import {
  EditHistogramChartForm,
  EditLineChartForm,
  EditMarkdownChartForm,
  EditNumberChartForm,
  EditSearchChartForm,
  EditTableChartForm,
} from './EditChartForm';
import { Histogram } from './SVGIcons';
import TabBar from './TabBar';
import type { Alert, Chart, Dashboard } from './types';

const EditTileForm = ({
  isLocalDashboard,
  chart,
  alerts,
  dateRange,
  onSave,
  onClose,
  editedChart,
  setEditedChart,
  displayedTimeInputValue,
  setDisplayedTimeInputValue,
  granularity,
  setGranularity,
  onTimeRangeSearch,
  hideMarkdown,
  hideSearch,
}: {
  isLocalDashboard: boolean;
  chart: Chart | undefined;
  alerts?: Alert[];
  dateRange: [Date, Date];
  displayedTimeInputValue?: string;
  setDisplayedTimeInputValue?: (value: string) => void;
  onTimeRangeSearch?: (value: string) => void;
  granularity?: Granularity;
  setGranularity?: (granularity: Granularity | undefined) => void;
  onSave?: (chart: Chart, alerts?: Alert[]) => void;
  onClose?: () => void;
  editedChart?: Chart;
  setEditedChart?: (chart: Chart) => void;
  hideMarkdown?: boolean;
  hideSearch?: boolean;
}) => {
  type Tab =
    | 'time'
    | 'search'
    | 'histogram'
    | 'markdown'
    | 'number'
    | 'table'
    | undefined;

  const [tab, setTab] = useState<Tab>(undefined);
  const displayedTab = tab ?? chart?.series?.[0]?.type ?? 'time';

  const onTabClick = useCallback(
    (newTab: Tab) => {
      setTab(newTab);
      if (setEditedChart != null && editedChart != null) {
        setEditedChart(
          produce(editedChart, draft => {
            for (const series of draft.series) {
              series.type = newTab ?? 'time';
            }
          }),
        );
      }
    },
    [setTab, setEditedChart, editedChart],
  );

  return (
    <>
      <TabBar
        className="fs-8 mb-3"
        items={[
          {
            text: (
              <span>
                <i className="bi bi-graph-up" /> Line Chart
              </span>
            ),
            value: 'time',
          },
          ...(hideSearch === true
            ? []
            : [
                {
                  text: (
                    <span>
                      <i className="bi bi-card-list" /> Search Results
                    </span>
                  ),
                  value: 'search' as const,
                },
              ]),
          {
            text: (
              <span>
                <i className="bi bi-table" /> Table
              </span>
            ),
            value: 'table',
          },
          {
            text: (
              <span>
                <Histogram width={12} color="#fff" /> Histogram
              </span>
            ),
            value: 'histogram',
          },
          {
            text: (
              <span>
                <i className="bi bi-123"></i> Number
              </span>
            ),
            value: 'number',
          },
          ...(hideMarkdown === true
            ? []
            : [
                {
                  text: (
                    <span>
                      <i className="bi bi-markdown"></i> Markdown
                    </span>
                  ),
                  value: 'markdown' as const,
                },
              ]),
        ]}
        activeItem={displayedTab}
        onClick={onTabClick}
      />
      {displayedTab === 'time' && chart != null && (
        <EditLineChartForm
          isLocalDashboard={isLocalDashboard}
          chart={produce(chart, draft => {
            for (const series of draft.series) {
              series.type = 'time';
            }
          })}
          alerts={alerts}
          onSave={onSave}
          onClose={onClose}
          dateRange={dateRange}
          editedChart={editedChart}
          setEditedChart={setEditedChart}
          setDisplayedTimeInputValue={setDisplayedTimeInputValue}
          displayedTimeInputValue={displayedTimeInputValue}
          onTimeRangeSearch={onTimeRangeSearch}
          granularity={granularity}
          setGranularity={setGranularity}
        />
      )}
      {displayedTab === 'table' && chart != null && (
        <EditTableChartForm
          chart={produce(chart, draft => {
            for (const series of draft.series) {
              series.type = 'table';
            }
          })}
          onSave={onSave}
          onClose={onClose}
          dateRange={dateRange}
          editedChart={editedChart}
          setEditedChart={setEditedChart}
          setDisplayedTimeInputValue={setDisplayedTimeInputValue}
          displayedTimeInputValue={displayedTimeInputValue}
          onTimeRangeSearch={onTimeRangeSearch}
        />
      )}
      {displayedTab === 'histogram' && chart != null && (
        <EditHistogramChartForm
          chart={produce(chart, draft => {
            draft.series[0].type = 'histogram';
          })}
          onSave={onSave}
          onClose={onClose}
          dateRange={dateRange}
          editedChart={editedChart}
          setEditedChart={setEditedChart}
          setDisplayedTimeInputValue={setDisplayedTimeInputValue}
          displayedTimeInputValue={displayedTimeInputValue}
          onTimeRangeSearch={onTimeRangeSearch}
        />
      )}
      {displayedTab === 'search' && chart != null && (
        <EditSearchChartForm
          chart={produce(chart, draft => {
            draft.series[0].type = 'search';
          })}
          onSave={onSave}
          onClose={onClose}
          dateRange={dateRange}
        />
      )}
      {displayedTab === 'number' && chart != null && (
        <EditNumberChartForm
          chart={produce(chart, draft => {
            draft.series[0].type = 'number';
          })}
          onSave={onSave}
          onClose={onClose}
          editedChart={editedChart}
          setEditedChart={setEditedChart}
          dateRange={dateRange}
          setDisplayedTimeInputValue={setDisplayedTimeInputValue}
          displayedTimeInputValue={displayedTimeInputValue}
          onTimeRangeSearch={onTimeRangeSearch}
        />
      )}
      {displayedTab === 'markdown' && chart != null && (
        <EditMarkdownChartForm
          chart={produce(chart, draft => {
            draft.series[0].type = 'markdown';
          })}
          onSave={onSave}
          onClose={onClose}
        />
      )}
    </>
  );
};

export default EditTileForm;
