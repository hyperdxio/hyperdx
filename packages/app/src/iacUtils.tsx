import { API_SERVER_URL } from './config';
import { Chart, Dashboard } from './types';

function getResourceName(name: string) {
  return name.toLowerCase().replace(/\W/g, '_');
}

function getDashboardResourceName(name: string) {
  return `dashboard_${getResourceName(name)}`;
}

function getChartResourceName(chart: Chart, dashboard: Dashboard | undefined) {
  const defaultName = `chart_${getResourceName(chart.name)}`;

  if (dashboard == null) {
    return defaultName;
  }

  if (dashboard.charts.filter(c => c.name === chart.name).length > 1) {
    return `${defaultName}_${chart.id}`;
  }

  return defaultName;
}

function getChartAlertResourceName(
  chart: Chart,
  dashboard: Dashboard | undefined,
) {
  return `alert_${getChartResourceName(chart, dashboard).replace(
    'chart_',
    '',
  )}`;
}

export function dashboardToTerraformImport(dashboard: Dashboard | undefined) {
  if (dashboard == null) {
    return '';
  }

  return (
    `terraform import restapi_object.${getDashboardResourceName(
      dashboard.name,
    )} /api/v1/dashboards/${dashboard._id}\n` +
    dashboard.alerts
      ?.map(alert => {
        const chart = dashboard.charts.find(
          chart => chart.id === alert.chartId,
        );
        if (chart == null) {
          return '';
        }

        return `terraform import restapi_object.${getChartAlertResourceName(
          chart,
          dashboard,
        )} /api/v1/alerts/${alert._id}`;
      })
      .filter(s => s !== '')
      ?.join('\n')
  ).trim();
}

export function dashboardToTerraform(
  dashboard: Dashboard | undefined,
  apiKey: string,
) {
  if (dashboard == null) {
    return '';
  }

  return `terraform {
  required_providers {
    restapi = {
      source = "Mastercard/restapi"
      version = "1.18.2"
    }
  }
}

provider "restapi" {
  uri                  = "${API_SERVER_URL}"
  write_returns_object = true
  debug                = true
  id_attribute         = "data/id"

  headers = {
    "Authorization" = "Bearer ${apiKey}", # Your Personal API Key
    "Content-Type" = "application/json"
  }
}

locals {
${dashboard.charts
  .map(
    chart => `  ${getChartResourceName(chart, dashboard)}_id = "${chart.id}"`,
  )
  .join('\n')}
}

resource "restapi_object" "dashboard_${getResourceName(dashboard.name)}" {
  path = "/api/v1/dashboards"
  data = jsonencode({
    "name": "${dashboard.name}",
    "query": "${dashboard.query}",${
    dashboard.tags != null
      ? `
    "tags": [${dashboard?.tags?.map(tag => `"${tag}"`).join(', ')}],
`
      : ''
  }
    "charts": [${dashboard.charts
      .map((chart, i) => {
        return (
          // Fix identation for following JSON objects
          (i > 0 ? '    ' : '') +
          JSON.stringify(
            {
              id: 'CHART_ID',
              name: chart.name,
              x: chart.x,
              y: chart.y,
              w: chart.w,
              h: chart.h,
              asRatio: chart.seriesReturnType === 'ratio',
              series: chart.series.map(s => ({
                type: s.type,
                ...(s.type === 'time' ||
                s.type === 'table' ||
                s.type === 'number'
                  ? {
                      dataSource: s.table === 'logs' ? 'events' : 'metrics',
                    }
                  : {}),
                ...('numberFormat' in s
                  ? { numberFormat: s.numberFormat }
                  : {}),
                ...('groupBy' in s ? { groupBy: s.groupBy } : {}),
                ...('sortOrder' in s ? { sortOrder: s.sortOrder } : {}),
                ...('where' in s ? { where: s.where } : {}),
                ...('field' in s ? { field: s.field } : {}),
                ...('content' in s ? { content: s.content } : {}),
                ...('aggFn' in s ? { aggFn: s.aggFn } : {}),
                ...('metricDataType' in s
                  ? { metricDataType: s.metricDataType }
                  : {}),
              })),
            },
            undefined,
            2,
          )
            .replace(/\n/g, '\n    ')
            // We need to replace it with a bare reference so it's not quoted
            .replace(
              '"CHART_ID"',
              `local.${getChartResourceName(chart, dashboard)}_id`,
            )
        );
      })
      .join(',\n')}]
  })
}

${
  dashboard.alerts
    ?.map(alert => {
      const chart = dashboard.charts.find(chart => chart.id === alert.chartId);
      if (chart == null) {
        return null;
      }

      const dashboardId = `restapi_object.dashboard_${getResourceName(
        dashboard.name,
      )}.id`;

      const chartId = `local.${getChartResourceName(chart, dashboard)}_id`;

      const alertJson = JSON.stringify(
        {
          interval: alert.interval,
          threshold: alert.threshold,
          threshold_type: alert.type === 'presence' ? 'above' : 'below',
          channel: {
            type: alert.channel.type === 'webhook' ? 'webhook' : '',
            ...('webhookId' in alert.channel
              ? { webhookId: alert.channel.webhookId }
              : {}),
          },
          source: 'chart',
          dashboardId: 'TO_POPULATE_DASHBOARD_ID',
          chartId: 'TO_POPULATE_CHART_ID',
        },
        undefined,
        2,
      )
        .replace(/\n/g, '\n  ')
        // Populate with bare variables, not quoted strings
        .replace('"TO_POPULATE_DASHBOARD_ID"', dashboardId)
        .replace('"TO_POPULATE_CHART_ID"', chartId);

      return `resource "restapi_object" "${getChartAlertResourceName(
        chart,
        dashboard,
      )}" {
  path = "/api/v1/alerts"
  data = jsonencode(${alertJson})
}`;
    })
    .filter(s => s != null)
    ?.join('\n\n') || ''
}`.trim();
}
