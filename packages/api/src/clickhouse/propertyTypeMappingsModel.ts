import type { ResponseJSON } from '@clickhouse/client';
import ms from 'ms';
import { serializeError } from 'serialize-error';

import { IS_DEV } from '@/config';
import logger from '@/utils/logger';
import redisClient from '@/utils/redis';

const stringifyMap = (map: Map<any, any>) => {
  return JSON.stringify(Array.from(map.entries()));
};

const parseStringifiedMap = (stringifiedMap: string): Map<string, any> => {
  return new Map(JSON.parse(stringifiedMap));
};

export abstract class PropertyTypeMappingsModel {
  abstract getCacheKey(): string;

  abstract ttl(): number;

  protected readonly tableVersion: number | undefined;

  protected readonly teamId: string;

  private readonly fetchPropertyTypeMappings: (
    tableVersion: number | undefined,
    teamId: string,
  ) => Promise<ResponseJSON<Record<string, any[]>>>;

  // hold the mapping state
  public currentPropertyTypeMappings: Map<string, 'string' | 'number' | 'bool'>;

  constructor(
    tableVersion: number | undefined,
    teamId: string,
    fetchPropertyTypeMappings: (
      tableVersion: number | undefined,
      teamId: string,
    ) => Promise<any>,
  ) {
    this.tableVersion = tableVersion;
    this.teamId = teamId;
    this.fetchPropertyTypeMappings = fetchPropertyTypeMappings;
    this.currentPropertyTypeMappings = new Map();
  }

  private bundlePropertyTypeMappings(
    raw: ResponseJSON<Record<string, any[]>> | null,
  ) {
    const mapping = new Map<string, 'string' | 'number' | 'bool'>();
    if (raw?.rows === 1) {
      const data = raw.data[0];
      data.strings?.map((property: string) => mapping.set(property, 'string'));
      data.numbers?.map((property: string) => mapping.set(property, 'number'));
      data.bools?.map((property: string) => mapping.set(property, 'bool'));
    }
    return mapping;
  }

  // decide if the cache is still valid
  private async needsRefresh() {
    return true;
  }

  // only used internally
  async _refresh({ incrementalUpdate }: { incrementalUpdate: boolean }) {
    logger.info({
      message: 'propertyTypeMappingsModel _refresh start',
      teamId: this.teamId,
    });
    try {
      const mappings = await this.fetchPropertyTypeMappings(
        this.tableVersion,
        this.teamId,
      );
      const oldMappings = this.currentPropertyTypeMappings;
      const newMappings = this.bundlePropertyTypeMappings(mappings);
      this.currentPropertyTypeMappings = incrementalUpdate
        ? new Map([...oldMappings, ...newMappings]) // WARNING: newMappings will overwrite oldMappings
        : newMappings;

      if (incrementalUpdate) {
        // if incrementalUpdate = true, we only update the value but keep the TTL
        await redisClient.set(
          this.getCacheKey(),
          stringifyMap(this.currentPropertyTypeMappings),
          {
            KEEPTTL: true,
          },
        );
      } else {
        await redisClient.set(
          this.getCacheKey(),
          stringifyMap(this.currentPropertyTypeMappings),
          {
            PX: this.ttl(),
          },
        );
      }

      logger.info({
        incrementalUpdate,
        message: 'propertyTypeMappingsModel _refresh success',
        teamId: this.teamId,
      });
    } catch (err) {
      logger.error({
        error: serializeError(err),
        incrementalUpdate,
        message: 'propertyTypeMappingsModel _refresh error',
        teamId: this.teamId,
      });
    }
  }

  _debug() {
    console.log([...this.currentPropertyTypeMappings.entries()]);
  }

  async init() {
    const cachedMappings: any = await redisClient.get(this.getCacheKey());
    if (cachedMappings) {
      logger.info({
        message: 'propertyTypeMappingsModel init: cache hit',
        teamId: this.teamId,
      });
      this.currentPropertyTypeMappings = parseStringifiedMap(cachedMappings);
    } else {
      logger.info({
        message: 'propertyTypeMappingsModel init: cache miss',
        teamId: this.teamId,
      });
      // cache miss
      await this._refresh({ incrementalUpdate: false });
    }
  }

  // used by the APIs
  async refresh() {
    logger.info({
      message: 'propertyTypeMappingsModel refresh: start',
      teamId: this.teamId,
    });
    if (await this.needsRefresh()) {
      logger.info({
        message: 'propertyTypeMappingsModel refresh: cache miss',
        teamId: this.teamId,
      });
      await this._refresh({ incrementalUpdate: true });
    } else {
      logger.info({
        message: 'propertyTypeMappingsModel refresh: cache hit',
        teamId: this.teamId,
      });
    }
  }

  get(property: string) {
    return this.currentPropertyTypeMappings.get(property);
  }

  size() {
    return this.currentPropertyTypeMappings.size;
  }

  remainingTTL() {
    return redisClient.pTTL(this.getCacheKey());
  }

  async isAboutToExpire() {
    return (await this.remainingTTL()) < ms('2h');
  }
}

export class LogsPropertyTypeMappingsModel extends PropertyTypeMappingsModel {
  getCacheKey() {
    return `logs_property_type_mappings:${this.teamId}`;
  }

  ttl() {
    return IS_DEV ? ms('5s') : ms('1d');
  }
}

export class MetricsPropertyTypeMappingsModel extends PropertyTypeMappingsModel {
  getCacheKey() {
    return `metrics_property_type_mappings:${this.teamId}`;
  }

  ttl() {
    return IS_DEV ? ms('5s') : ms('1d');
  }
}
