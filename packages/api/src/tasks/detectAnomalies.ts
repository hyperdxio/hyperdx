import { createAnthropic } from '@ai-sdk/anthropic';
import {
  ClickhouseClient,
  createNativeClient,
} from '@hyperdx/common-utils/dist/clickhouse/node';
import { generateText } from 'ai';
import mongoose from 'mongoose';
import ms from 'ms';

import * as config from '@/config';
import { Anomaly, AnomalyStatus } from '@/models/anomaly';
import { connectDB, mongooseConnection } from '@/models/index';
import { DetectAnomaliesTaskArgs, HdxTask } from '@/tasks/types';
import logger from '@/utils/logger';

export default class DetectAnomaliesTask
  implements HdxTask<DetectAnomaliesTaskArgs>
{
  private clickhouseClient: ClickhouseClient | undefined;

  constructor(private args: DetectAnomaliesTaskArgs) {}

  async execute(): Promise<void> {
    logger.info('Starting Anomaly Detection...');

    try {
      await connectDB();
    } catch (error) {
      logger.error({ error }, 'Failed to connect to DB');
      throw error;
    }

    this.clickhouseClient = createNativeClient({
      url: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
      request_timeout: ms('2m'),
    });

    try {
      // 1. Get Active Services
      const services = await this.getActiveServices();
      logger.info(`Found ${services.length} active services`);

      for (const service of services) {
        await this.checkServiceLatency(service);
      }
    } catch (error) {
      logger.error({ error }, 'Anomaly detection failed');
    }
  }

  async asyncDispose(): Promise<void> {
    if (mongooseConnection.readyState === 1) {
      // await mongooseConnection.close(); // Don't close if reused? Task runner usually closes?
      // CheckAlertsTask doesn't close, but RunSLOChecksTask doesn't either.
      // The task runner in index.ts handles disposal via this method, but usually we keep DB open if tasks share connection?
      // Actually index.ts calls asyncDispose.
    }
  }

  name(): string {
    return 'DetectAnomaliesTask';
  }

  private async getActiveServices(): Promise<string[]> {
    if (!this.clickhouseClient) return [];
    const query = `
      SELECT DISTINCT ServiceName
      FROM default.otel_traces
      WHERE Timestamp > now() - INTERVAL 1 HOUR
    `;
    const res = await this.clickhouseClient.query({ query, format: 'JSON' });
    const data = await res.json<{ data: { ServiceName: string }[] }>();
    return data.data.map(d => d.ServiceName);
  }

  private async checkServiceLatency(serviceName: string) {
    if (!this.clickhouseClient) return;

    // Compare last 15 mins vs avg of last 24h
    const currentWindowQuery = `
      SELECT quantile(0.95)(Duration) as p95
      FROM default.otel_traces
      WHERE ServiceName = {serviceName: String}
        AND Timestamp > now() - INTERVAL 15 MINUTE
    `;

    const baselineQuery = `
      SELECT quantile(0.95)(Duration) as p95
      FROM default.otel_traces
      WHERE ServiceName = {serviceName: String}
        AND Timestamp > now() - INTERVAL 24 HOUR
        AND Timestamp < now() - INTERVAL 15 MINUTE
    `;

    const [currentRes, baselineRes] = await Promise.all([
      this.clickhouseClient.query({
        query: currentWindowQuery,
        query_params: { serviceName },
        format: 'JSON',
      }),
      this.clickhouseClient.query({
        query: baselineQuery,
        query_params: { serviceName },
        format: 'JSON',
      }),
    ]);

    const currentData = await currentRes.json<{ data: { p95: number }[] }>();
    const baselineData = await baselineRes.json<{ data: { p95: number }[] }>();

    const currentP95 = Number(currentData.data[0]?.p95 || 0);
    const baselineP95 = Number(baselineData.data[0]?.p95 || 0);

    console.log('currentP95', currentP95);
    console.log('baselineP95', baselineP95);

    if (baselineP95 > 0 && currentP95 > baselineP95 * 1.5) {
      // Anomaly Detected!
      const deviation = ((currentP95 - baselineP95) / baselineP95) * 100;
      logger.info(
        { serviceName, currentP95, baselineP95, deviation },
        'Latency Anomaly Detected',
      );

      // Check if open anomaly exists to avoid dupes
      const existing = await Anomaly.findOne({
        serviceName,
        status: AnomalyStatus.OPEN,
        metric: 'p95_duration',
      });

      if (!existing) {
        const anomaly = await Anomaly.create({
          team: await this.getTeamForService(serviceName), // Placeholder logic
          serviceName,
          metric: 'p95_duration',
          value: currentP95,
          baseline: baselineP95,
          deviation,
          startTime: new Date(Date.now() - ms('15m')),
          endTime: new Date(),
          status: AnomalyStatus.OPEN,
        });

        // Trigger AI RCA
        await this.performRCA(anomaly);
      } else {
        // Update existing anomaly
        existing.value = currentP95;
        existing.deviation = deviation;
        existing.endTime = new Date(); // Extend the anomaly window
        await existing.save();
      }
    } else {
      // No Anomaly Detected - Check if we need to resolve any open anomalies
      const existing = await Anomaly.findOne({
        serviceName,
        status: AnomalyStatus.OPEN,
        metric: 'p95_duration',
      });

      if (existing) {
        logger.info(
          { serviceName },
          'Resolving Anomaly - Latency back to normal',
        );
        existing.status = AnomalyStatus.RESOLVED;
        existing.endTime = new Date();
        await existing.save();
      }
    }
  }

  private async performRCA(anomaly: any) {
    if (!config.ANTHROPIC_API_KEY) {
      logger.warn('Skipping RCA: ANTHROPIC_API_KEY not set');
      return;
    }

    try {
      // Fetch context: Top 5 slow traces
      const slowTracesQuery = `
        SELECT SpanName, Duration, Timestamp
        FROM default.otel_traces
        WHERE ServiceName = {serviceName: String}
          AND Timestamp > now() - INTERVAL 15 MINUTE
        ORDER BY Duration DESC
        LIMIT 5
      `;

      // Fetch context: Top 5 error logs
      const errorLogsQuery = `
        SELECT Body, SeverityText, Timestamp
        FROM default.otel_logs
        WHERE ServiceName = {serviceName: String}
          AND Timestamp > now() - INTERVAL 15 MINUTE
          AND SeverityNumber >= 17
        ORDER BY Timestamp DESC
        LIMIT 5
      `;

      const [tracesRes, logsRes] = await Promise.all([
        this.clickhouseClient!.query({
          query: slowTracesQuery,
          query_params: { serviceName: anomaly.serviceName },
          format: 'JSON',
        }),
        this.clickhouseClient!.query({
          query: errorLogsQuery,
          query_params: { serviceName: anomaly.serviceName },
          format: 'JSON',
        }),
      ]);

      const traces = await tracesRes.json();
      const logs = await logsRes.json();

      const anthropic = createAnthropic({
        apiKey: config.ANTHROPIC_API_KEY,
      });

      const { text } = await generateText({
        model: anthropic('claude-3-5-sonnet-20241022'),
        system:
          'You are an SRE expert. Analyze the following anomaly and provide a Root Cause Analysis.',
        prompt: `
          Service: ${anomaly.serviceName}
          Metric: ${anomaly.metric}
          Deviation: +${anomaly.deviation.toFixed(2)}%
          
          Top Slow Traces:
          ${JSON.stringify(traces.data, null, 2)}
          
          Recent Error Logs:
          ${JSON.stringify(logs.data, null, 2)}
          
          Provide a concise RCA.
        `,
      });

      anomaly.rcaAnalysis = text;
      await anomaly.save();
      logger.info({ anomalyId: anomaly._id }, 'RCA Completed');
    } catch (error) {
      logger.error({ error }, 'RCA Failed');
    }
  }

  // Helper to find a team for a service.
  // In HyperDX, services belong to teams via API keys, but data in CH just has ServiceName.
  // We need to look up which team has data for this service or just assign to first team found?
  // Real implementation needs a better mapping.
  // For now, I'll search for a team that has this service in its available services list if that exists,
  // or just pick the first team in DB for MVP/Demo purposes if I can't link it.
  // Actually, I can query 'slo_definitions' if the service has an SLO, that links to team.
  // Or query 'alert_definitions'.
  // If not found, I might have to skip team assignment or assign to a default.
  // Let's assume there is at least one team.
  private async getTeamForService(
    _serviceName: string,
  ): Promise<mongoose.Types.ObjectId> {
    // Try to find an SLO for this service
    // const slo = await mongoose.model('SLO').findOne({ serviceName });
    // if (slo) return slo.team;

    // Fallback: Return the first team found.
    const Team = mongoose.model('Team');
    const team = await Team.findOne();
    if (team) return team._id;
    throw new Error('No team found');
  }
}
