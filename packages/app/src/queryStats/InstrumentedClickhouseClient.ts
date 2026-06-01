import type {
  BaseResultSet,
  DataFormat,
} from '@hyperdx/common-utils/dist/clickhouse';
import { QueryInputs } from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';

import {
  appendQueryEvent,
  QueryEventKind,
  updateQueryEvent,
} from './queryStatsStore';

let warnedOnce = false;
function safeWarn(message: string, error: unknown) {
  if (warnedOnce) return;
  warnedOnce = true;

  console.warn(`[QueryStats] ${message}`, error);
}

// RFC 4122 v4-shaped UUID built with Math.random (no crypto dep).
function generateQueryId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function detectKind(sql: string): QueryEventKind {
  return /^\s*EXPLAIN\b/i.test(sql) ? 'explain' : 'query';
}

function currentPathname(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.location?.pathname ?? '';
  } catch {
    return '';
  }
}

export class InstrumentedClickhouseClient extends ClickhouseClient {
  async query<Format extends DataFormat>(
    props: QueryInputs<Format>,
  ): Promise<BaseResultSet<ReadableStream, Format>> {
    let queryId = props.queryId;
    let eventId: string | undefined;
    let startedAt = 0;
    let captured = false;

    try {
      queryId = queryId ?? generateQueryId();
      eventId = queryId;
      startedAt = performance.now();
      appendQueryEvent({
        id: eventId,
        queryId,
        sql: props.query,
        params: props.query_params ?? {},
        status: 'pending',
        startedAt: startedAt,
        pathname: currentPathname(),
        connectionId: props.connectionId,
        kind: detectKind(props.query),
      });
      captured = true;
    } catch (error) {
      safeWarn('failed to capture pending event', error);
    }

    const nextProps = captured ? { ...props, queryId } : props;

    try {
      const result = await super.query<Format>(nextProps);
      if (captured && eventId) {
        try {
          updateQueryEvent(eventId, {
            status: 'done',
            durationMs: performance.now() - startedAt,
          });
        } catch (error) {
          safeWarn('failed to update done event', error);
        }
      }
      return result;
    } catch (error) {
      if (captured && eventId) {
        try {
          const aborted = props.abort_signal?.aborted === true;
          updateQueryEvent(eventId, {
            status: aborted ? 'cancelled' : 'error',
            durationMs: performance.now() - startedAt,
            error:
              error instanceof Error ? error.message : String(error ?? 'error'),
          });
        } catch (innerError) {
          safeWarn('failed to update error event', innerError);
        }
      }
      throw error;
    }
  }
}

// Test-only: reset the once-only warn flag between specs.
export function __resetInstrumentationWarnForTests(): void {
  warnedOnce = false;
}
