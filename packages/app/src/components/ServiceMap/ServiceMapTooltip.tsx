import { useCallback } from 'react';
import SqlString from 'sqlstring';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Button, Group, Stack, UnstyledButton } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

import { formatApproximateNumber, navigateToTraceSearch } from './utils';

import styles from './ServiceMap.module.scss';

export default function ServiceMapTooltip({
  totalRequests,
  errorPercentage,
  source,
  dateRange,
  serviceName,
  isSingleTrace,
}: {
  totalRequests: number;
  errorPercentage: number;
  source: TSource;
  dateRange: [Date, Date];
  serviceName: string;
  isSingleTrace?: boolean;
}) {
  const requestText = `${isSingleTrace ? totalRequests : formatApproximateNumber(totalRequests)} request${
    totalRequests !== 1 ? 's' : ''
  }`;
  const errorsText = `${errorPercentage.toFixed(2)}% errors`;

  const handleRequestsClick = useCallback(() => {
    navigateToTraceSearch({
      dateRange,
      source,
      where: SqlString.format("? = ? AND ? IN ('Server', 'Consumer')", [
        SqlString.raw(source.serviceNameExpression ?? 'ServiceName'),
        serviceName,
        SqlString.raw(source.spanKindExpression ?? 'SpanKind'),
      ]),
    });
  }, [dateRange, source, serviceName]);

  const handleErrorsClick = useCallback(() => {
    navigateToTraceSearch({
      dateRange,
      source,
      where: SqlString.format(
        "? = ? AND ? IN ('Server', 'Consumer') AND ? = 'Error'",
        [
          SqlString.raw(source.serviceNameExpression ?? 'ServiceName'),
          serviceName,
          SqlString.raw(source.spanKindExpression ?? 'SpanKind'),
          SqlString.raw(source.statusCodeExpression ?? 'StatusCode'),
        ],
      ),
    });
  }, [dateRange, source, serviceName]);

  return (
    <Stack className={styles.toolbar} gap={0}>
      <Button
        onClick={handleRequestsClick}
        variant="subtle"
        size="xs"
        color="var(--color-text)"
        rightSection={<IconSearch size={16} />}
      >
        {requestText}
      </Button>
      {errorPercentage > 0 ? (
        <>
          <Button
            onClick={handleErrorsClick}
            variant="subtle"
            size="xs"
            color="var(--color-text-danger)"
            rightSection={<IconSearch size={16} />}
          >
            {errorsText}
          </Button>
        </>
      ) : null}
    </Stack>
  );
}
