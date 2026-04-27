import { z } from 'zod';

import { getConnectionsByTeam } from '@/controllers/connection';
import { getSources } from '@/controllers/sources';
import logger from '@/utils/logger';

import type { PromptDefinition } from '../../tools/types';
import {
  buildCreateDashboardPrompt,
  buildDashboardExamplesPrompt,
  buildQueryGuidePrompt,
} from './content';
import {
  buildSourceSummary,
  getFirstConnectionId,
  getFirstSourceId,
} from './helpers';

const dashboardPrompts: PromptDefinition = (server, context) => {
  const { teamId } = context;

  // ── create_dashboard ──────────────────────────────────────────────────────

  server.registerPrompt(
    'create_dashboard',
    {
      title: 'Create a Dashboard',
      description:
        'Create a HyperDX dashboard with the MCP tools. ' +
        'Follow the recommended workflow, pick tile types, write queries, ' +
        'and validate results — using your real data sources.',
      argsSchema: {
        description: z
          .string()
          .optional()
          .describe(
            'What the dashboard should monitor (e.g. "API error rates and latency")',
          ),
      },
    },
    async ({ description }) => {
      let sourceSummary: string;
      let traceSourceId: string;
      let logSourceId: string;

      try {
        const [sources, connections] = await Promise.all([
          getSources(teamId),
          getConnectionsByTeam(teamId),
        ]);

        sourceSummary = buildSourceSummary(
          sources.map(s => ({
            _id: s._id,
            name: s.name,
            kind: s.kind,
            connection: s.connection,
          })),
          connections.map(c => ({ _id: c._id, name: c.name })),
        );
        traceSourceId = getFirstSourceId(
          sources.map(s => ({ _id: s._id, kind: s.kind })),
          'trace',
        );
        logSourceId = getFirstSourceId(
          sources.map(s => ({ _id: s._id, kind: s.kind })),
          'log',
        );
      } catch (e) {
        logger.warn(
          { teamId, error: e },
          'Failed to fetch sources for create_dashboard prompt',
        );
        sourceSummary =
          'Could not fetch sources. Call hyperdx_list_sources to discover available data.';
        traceSourceId = '<SOURCE_ID>';
        logSourceId = '<SOURCE_ID>';
      }

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: buildCreateDashboardPrompt(
                sourceSummary,
                traceSourceId,
                logSourceId,
                description,
              ),
            },
          },
        ],
      };
    },
  );

  // ── dashboard_examples ────────────────────────────────────────────────────

  server.registerPrompt(
    'dashboard_examples',
    {
      title: 'Dashboard Examples',
      description:
        'Get copy-paste-ready dashboard examples for common observability patterns: ' +
        'service_overview, error_tracking, latency, log_analysis, infrastructure_sql.',
      argsSchema: {
        pattern: z
          .string()
          .optional()
          .describe(
            'Filter to a specific pattern: service_overview, error_tracking, latency, log_analysis, infrastructure_sql',
          ),
      },
    },
    async ({ pattern }) => {
      let traceSourceId: string;
      let logSourceId: string;
      let connectionId: string;

      try {
        const [sources, connections] = await Promise.all([
          getSources(teamId),
          getConnectionsByTeam(teamId),
        ]);

        traceSourceId = getFirstSourceId(
          sources.map(s => ({ _id: s._id, kind: s.kind })),
          'trace',
        );
        logSourceId = getFirstSourceId(
          sources.map(s => ({ _id: s._id, kind: s.kind })),
          'log',
        );
        connectionId = getFirstConnectionId(
          connections.map(c => ({ _id: c._id })),
        );
      } catch (e) {
        logger.warn(
          { teamId, error: e },
          'Failed to fetch sources for dashboard_examples prompt',
        );
        traceSourceId = '<TRACE_SOURCE_ID>';
        logSourceId = '<LOG_SOURCE_ID>';
        connectionId = '<CONNECTION_ID>';
      }

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: buildDashboardExamplesPrompt(
                traceSourceId,
                logSourceId,
                connectionId,
                pattern,
              ),
            },
          },
        ],
      };
    },
  );

  // ── query_guide ───────────────────────────────────────────────────────────

  server.registerPrompt(
    'query_guide',
    {
      title: 'Query Writing Guide',
      description:
        'Look up HyperDX query syntax: aggregation functions, ' +
        'Lucene/SQL filters, raw SQL macros, column naming, ' +
        'per-tile constraints, and common mistakes.',
    },
    async () => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: buildQueryGuidePrompt(),
            },
          },
        ],
      };
    },
  );
};

export default dashboardPrompts;
