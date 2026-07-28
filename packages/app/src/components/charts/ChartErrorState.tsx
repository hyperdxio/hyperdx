import { useMemo } from 'react';
import cx from 'classnames';
import { useTranslation } from 'react-i18next';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { Button, Code, Group, Modal, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconArrowsDiagonal } from '@tabler/icons-react';

import { SQLPreview } from '@/components/ChartSQLPreview';

export type ChartErrorStateVariant = 'collapsible' | 'inline';

export default function ChartErrorState({
  error,
  variant = 'collapsible',
}: {
  error: Error | ClickHouseQueryError;
  variant?: ChartErrorStateVariant;
}) {
  const { t } = useTranslation('charts');
  const [isErrorExpanded, errorExpansion] = useDisclosure(false);

  const details = useMemo(() => {
    return (
      <Stack align="start">
        <Text size="sm" mt={10}>
          {t('common.errorMessage')}
        </Text>
        <Code
          flex={1}
          block
          style={{
            whiteSpace: 'pre-wrap',
          }}
        >
          {error.message}
        </Code>
        {error instanceof ClickHouseQueryError && (
          <>
            <Text size="sm" ta="center">
              {t('common.sentQuery')}
            </Text>
            <SQLPreview data={error?.query} enableLineWrapping />
          </>
        )}
      </Stack>
    );
  }, [error, t]);

  return (
    <div
      className={cx(
        'h-100 w-100 d-flex g-1 flex-column align-items-center text-muted overflow-scroll',
        {
          'justify-content-center': variant === 'collapsible',
        },
      )}
    >
      <Text ta="center" size="sm" my="sm">
        {t('errorState.errorLoading')}
      </Text>

      {variant === 'collapsible' ? (
        <>
          <Button
            className="mx-auto"
            variant="danger"
            onClick={() => errorExpansion.open()}
          >
            <Group gap="xxs">
              <IconArrowsDiagonal size={16} />
              {t('errorState.seeErrorDetails')}
            </Group>
          </Button>
          <Modal
            opened={isErrorExpanded}
            onClose={() => errorExpansion.close()}
            title={t('errorState.errorDetails')}
            size="lg"
          >
            {details}
          </Modal>
        </>
      ) : (
        details
      )}
    </div>
  );
}
