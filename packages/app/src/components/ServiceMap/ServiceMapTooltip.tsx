import SqlString from 'sqlstring';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { UnstyledButton } from '@mantine/core';

import { formatApproximateNumber, navigateToTraceSearch } from './utils';

import styles from './ServiceMap.module.scss';

export default function ServiceMapTooltip({
  totalRequests,
  errorPercentage,
  source,
  dateRange,
  serviceName,
}: {
  totalRequests: number;
  errorPercentage: number;
  source: TSource;
  dateRange: [Date, Date];
  serviceName: string;
}) {
  return (
    <div className={styles.toolbar}>
      <UnstyledButton
        onClick={() =>
          navigateToTraceSearch({
            dateRange,
            source,
            where: SqlString.format("? = ? AND ? IN ('Server', 'Consumer')", [
              SqlString.raw(source.serviceNameExpression ?? 'ServiceName'),
              serviceName,
              SqlString.raw(source.spanKindExpression ?? 'SpanKind'),
            ]),
          })
        }
        className={styles.linkButton}
      >
        {formatApproximateNumber(totalRequests)} request
        {totalRequests !== 1 ? 's' : ''}
      </UnstyledButton>
      {errorPercentage > 0 ? (
        <>
          {', '}
          <UnstyledButton
            onClick={() =>
              navigateToTraceSearch({
                dateRange,
                source,
                where: SqlString.format(
                  "? = ? AND ? IN ('Server', 'Consumer') AND ? = 'Error'",
                  [
                    SqlString.raw(
                      source.serviceNameExpression ?? 'ServiceName',
                    ),
                    serviceName,
                    SqlString.raw(source.spanKindExpression ?? 'SpanKind'),
                    SqlString.raw(source.statusCodeExpression ?? 'StatusCode'),
                  ],
                ),
              })
            }
            className={styles.linkButton}
          >
            {errorPercentage.toFixed(2)}% error
          </UnstyledButton>
        </>
      ) : null}
    </div>
  );
}
