import { ClickhouseClient, createNativeClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import ms from 'ms';

import * as config from '@/config';
import { getAllTeams } from '@/controllers/team';
import Service, { ServiceReadiness, ServiceTier } from '@/models/service';
import ServiceCheck, { CheckStatus, CheckType } from '@/models/serviceCheck';
import SLO from '@/models/slo';
import logger from '@/utils/logger';
import { HdxTask, TaskArgs } from './types';
import { connectDB, mongooseConnection } from '@/models';

// Defines the weight of each check towards the score (optional, for now using basic pass/fail logic)
const CHECK_WEIGHTS = {
  [CheckType.HAS_OWNER]: 1,
  [CheckType.HAS_RUNBOOK]: 1,
  [CheckType.HAS_REPO]: 1,
  [CheckType.HAS_SLO]: 2, // Critical
  [CheckType.HAS_LOGS]: 1,
  [CheckType.HAS_TRACES]: 1,
};

export default class RunReadinessChecksTask implements HdxTask<TaskArgs> {
  private clickhouseClient: ClickhouseClient | null = null;

  constructor(private args: TaskArgs) {}

  async execute(): Promise<void> {
    logger.info('Starting readiness checks task...');

    if (mongooseConnection.readyState !== 1) {
      await connectDB();
    }

    this.clickhouseClient = createNativeClient({
      url: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
      request_timeout: ms('1m'),
      compression: {
        request: false,
        response: false,
      },
    });

    const teams = await getAllTeams();
    let totalChecked = 0;

    for (const team of teams) {
      try {
        const services = await Service.find({ team: team._id });
        
        for (const service of services) {
          totalChecked++;
          const checks: { type: CheckType; status: CheckStatus; message?: string }[] = [];

          // 1. Metadata Checks
          checks.push({
            type: CheckType.HAS_OWNER,
            status: service.owner ? CheckStatus.PASS : CheckStatus.FAIL,
            message: service.owner ? undefined : 'Service has no owner assigned',
          });

          checks.push({
            type: CheckType.HAS_RUNBOOK,
            status: service.runbookUrl ? CheckStatus.PASS : CheckStatus.FAIL,
            message: service.runbookUrl ? undefined : 'Service has no runbook URL',
          });

          checks.push({
            type: CheckType.HAS_REPO,
            status: service.repoUrl ? CheckStatus.PASS : CheckStatus.FAIL,
            message: service.repoUrl ? undefined : 'Service has no repository URL',
          });

          // 2. SLO Check
          const sloCount = await SLO.countDocuments({ 
            team: team._id, 
            serviceName: service.name 
          });
          checks.push({
            type: CheckType.HAS_SLO,
            status: sloCount > 0 ? CheckStatus.PASS : CheckStatus.FAIL,
            message: sloCount > 0 ? undefined : 'Service has no SLOs defined',
          });

          // 3. Telemetry Checks (using ClickHouse)
          // We check for presence of data in the last 24h
          try {
            const hasLogs = await this.checkTelemetryPresence(team._id.toString(), service.name, 'otel_logs');
            checks.push({
              type: CheckType.HAS_LOGS,
              status: hasLogs ? CheckStatus.PASS : CheckStatus.FAIL,
              message: hasLogs ? undefined : 'No logs detected in the last 24 hours',
            });

            const hasTraces = await this.checkTelemetryPresence(team._id.toString(), service.name, 'otel_traces');
            checks.push({
              type: CheckType.HAS_TRACES,
              status: hasTraces ? CheckStatus.PASS : CheckStatus.FAIL,
              message: hasTraces ? undefined : 'No traces detected in the last 24 hours',
            });

          } catch (err) {
            logger.error({ err, service: service.name }, 'Failed to check telemetry presence');
             // Default to fail if we can't check
             checks.push({ type: CheckType.HAS_LOGS, status: CheckStatus.FAIL, message: 'Failed to verify logs' });
             checks.push({ type: CheckType.HAS_TRACES, status: CheckStatus.FAIL, message: 'Failed to verify traces' });
          }

          // Persist Checks
          for (const check of checks) {
            await ServiceCheck.findOneAndUpdate(
              { service: service._id, checkType: check.type },
              { 
                $set: { 
                  team: team._id,
                  status: check.status,
                  message: check.message,
                  updatedAt: new Date()
                } 
              },
              { upsert: true }
            );
          }

          // Calculate Readiness Score
          // Simple logic for now:
          // GOLD: All checks pass
          // SILVER: Has SLO + Logs + Traces (Core telemetry + 1 reliability metric)
          // BRONZE: Has Logs + Traces
          // FAIL: Missing core telemetry
          
          let readiness = ServiceReadiness.FAIL;
          const passed = new Set(checks.filter(c => c.status === CheckStatus.PASS).map(c => c.type));
          
          const hasCoreTelemetry = passed.has(CheckType.HAS_LOGS) && passed.has(CheckType.HAS_TRACES);
          const hasSLO = passed.has(CheckType.HAS_SLO);
          const hasMetadata = passed.has(CheckType.HAS_OWNER) && passed.has(CheckType.HAS_RUNBOOK) && passed.has(CheckType.HAS_REPO);

          if (hasCoreTelemetry && hasSLO && hasMetadata) {
            readiness = ServiceReadiness.GOLD;
          } else if (hasCoreTelemetry && hasSLO) {
            readiness = ServiceReadiness.SILVER;
          } else if (hasCoreTelemetry) {
            readiness = ServiceReadiness.BRONZE;
          }

          await Service.findByIdAndUpdate(service._id, { 
            readiness,
            lastSeenAt: new Date(), // Update last seen as we just processed it
          });
        }
      } catch (err) {
        logger.error({ err, teamId: team._id }, 'Error running readiness checks for team');
      }
    }

    logger.info({ totalChecked }, 'Readiness checks task completed');
  }

  private async checkTelemetryPresence(teamId: string, serviceName: string, table: string): Promise<boolean> {
    if (!this.clickhouseClient) return false;
    
    // TODO: Ideally we filter by team ID if CH supports it in the future or via map
    // For now we rely on service name being unique enough or just checking existence
    // But wait, services are per team.
    // Discovery uses `tableFilterExpression` from Sources. 
    // Here we don't have the source handy easily without querying Sources.
    // For simplicity/performance, let's just check if *any* data exists for this service name.
    // In a multi-tenant DB this might be slightly inaccurate if two teams have "api" service, 
    // but typically they are siloed by how we query.
    // To be correct, we should get the sources for the team and use their filters.
    // But finding *which* source corresponds to *this* service is tricky if we don't store that link.
    // However, `Service` model implies we know the name.
    
    // Use a simple query for now.
    const query = `
      SELECT count() as count
      FROM default.${table}
      WHERE ServiceName = '${serviceName}'
      AND Timestamp > now() - INTERVAL 24 HOUR
    `;

    const result = await this.clickhouseClient.query({ query, format: 'JSONEachRow' });
    const rows = await result.json<Array<{ count: string }>>();
    return parseInt(rows[0]?.count || '0', 10) > 0;
  }

  async asyncDispose(): Promise<void> {
    if (this.clickhouseClient) {
      await this.clickhouseClient.close();
    }
  }

  name(): string {
    return 'RunReadinessChecksTask';
  }
}

