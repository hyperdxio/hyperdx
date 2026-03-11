import { useMemo } from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { Button, Code, Group, Modal, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconArrowsDiagonal } from '@tabler/icons-react';

import { SQLPreview } from '../ChartSQLPreview';

export type ChartErrorStateVariant = 'collapsible' | 'inline';

export default function ChartErrorState({
  error,
  variant = 'collapsible',
}: {
  error: Error | ClickHouseQueryError;
  variant?: ChartErrorStateVariant;
}) {
  const [isErrorExpanded, errorExpansion] = useDisclosure(false);

  const details = useMemo(() => {
    return (
      <Stack align="start">
        <Text size="sm" mt={10}>
          Error Message:
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
              Sent Query:
            </Text>
            <SQLPreview data={error?.query} enableLineWrapping />
          </>
        )}
      </Stack>
    );
  }, [error]);

  return (
    <div className="h-100 w-100 d-flex g-1 flex-column align-items-center justify-content-center text-muted overflow-auto">
      <Text ta="center" size="sm" my="sm">
        Error loading chart, please check your query or try again later.
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
              See Error Details
            </Group>
          </Button>
          <Modal
            opened={isErrorExpanded}
            onClose={() => errorExpansion.close()}
            title="Error Details"
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
