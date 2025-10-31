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
            where: `${source.serviceNameExpression} = '${serviceName}' AND ${source.spanKindExpression} IN ('Server', 'Consumer')`,
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
                where: `${source.serviceNameExpression} = '${serviceName}' AND ${source.spanKindExpression} IN ('Server', 'Consumer') AND ${source.statusCodeExpression} = 'Error'`,
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
