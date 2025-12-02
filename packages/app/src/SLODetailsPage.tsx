import React, { useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  Badge,
  Box,
  Button,
  Card,
  Container,
  Group,
  Stack,
  Text,
  Title,
  LoadingOverlay,
  Grid,
} from '@mantine/core';
import { IconTrash, IconArrowLeft } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';

import api from './api';
import SLOStatusCard from './components/SLOStatusCard';
import { useNewTimeQuery, parseTimeQuery } from './timeQuery';
import { TimePicker } from './components/TimePicker';
import { useConfirm } from './useConfirm';

function BubbleUpAnalysis({
  sloId,
  timeStart,
  timeEnd,
}: {
  sloId: string;
  timeStart: Date;
  timeEnd: Date;
}) {
  const { data, isLoading } = api.useSLOBubbleUp(sloId, timeStart, timeEnd);

  if (isLoading)
    return (
      <Box py="xl" pos="relative" mih={200}>
        <LoadingOverlay visible />
      </Box>
    );

  if (!data || data.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No significant correlations found or BubbleUp not supported for this
        SLO. Try a larger time window or ensure the SLO was created with the
        builder.
      </Text>
    );
  }

  return (
    <Stack gap="lg">
      {data.map((attr: any) => (
        <Card key={attr.attribute} withBorder padding="sm">
          <Text
            fw={500}
            size="sm"
            mb="xs"
            style={{ textTransform: 'capitalize' }}
          >
            {attr.attribute}
          </Text>
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '14px',
              }}
            >
              <thead>
                <tr
                  style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}
                >
                  <th style={{ padding: '8px' }}>Value</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>
                    Bad Events
                  </th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>
                    Good Events
                  </th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>% Bad</th>
                </tr>
              </thead>
              <tbody>
                {attr.values.map((val: any) => {
                  const total = val.badCount + val.goodCount;
                  const pctBad = total > 0 ? (val.badCount / total) * 100 : 0;
                  return (
                    <tr
                      key={val.value}
                      style={{ borderBottom: '1px solid #f5f5f5' }}
                    >
                      <td
                        style={{
                          padding: '8px',
                          maxWidth: 300,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={val.value}
                      >
                        {val.value}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {val.badCount}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {val.goodCount}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        <Badge color="red" variant="light" size="sm">
                          {pctBad.toFixed(1)}%
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </Stack>
  );
}

function BurnRateChart({
  data,
  isLoading,
}: {
  data: any[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return <LoadingOverlay visible={true} />;
  }

  if (!data || data.length === 0) {
    return (
      <Box
        h={300}
        display="flex"
        style={{ alignItems: 'center', justifyContent: 'center' }}
      >
        <Text c="dimmed">No burn rate data available for this time range</Text>
      </Box>
    );
  }

  return (
    <Box h={300}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={val => format(new Date(val), 'MMM d HH:mm')}
            minTickGap={30}
          />
          <YAxis />
          <Tooltip
            labelFormatter={label => format(new Date(label), 'MMM d HH:mm:ss')}
            formatter={(value: number) => [value.toFixed(2), 'Burn Rate']}
          />
          <Area
            type="monotone"
            dataKey="burnRate"
            stroke="#fa5252"
            fill="#fa5252"
            fillOpacity={0.1}
            name="Burn Rate"
          />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}

function SLODetailsPage() {
  const router = useRouter();
  const sloId = router.query.id as string;
  const confirm = useConfirm();

  const { data: slo, isLoading: isSLOLoading } = api.useSLO(sloId, {
    enabled: !!sloId,
  });

  const { data: status, isLoading: isStatusLoading } = api.useSLOStatus(sloId, {
    enabled: !!sloId,
  });

  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState('Past 24h');

  // Memoize initialTimeRange to prevent infinite loops - parseTimeQuery creates new Date objects
  const initialTimeRange = useMemo(
    () => parseTimeQuery('Past 24h', false) as [Date, Date],
    [],
  );

  const { searchedTimeRange, onSearch } = useNewTimeQuery({
    initialDisplayValue: 'Past 24h',
    initialTimeRange,
    setDisplayedTimeInputValue,
  });

  // Memoize the time range values for stable references in query keys
  const timeStart = useMemo(
    () => searchedTimeRange[0],
    [searchedTimeRange[0]?.getTime()],
  );
  const timeEnd = useMemo(
    () => searchedTimeRange[1],
    [searchedTimeRange[1]?.getTime()],
  );

  const { data: burnRateData, isLoading: isBurnRateLoading } =
    api.useSLOBurnRate(sloId, timeStart, timeEnd, {
      enabled: !!sloId,
    });

  const deleteSLO = api.useDeleteSLO();

  const handleDelete = async () => {
    if (
      await confirm(
        'Are you sure you want to delete this SLO? This action cannot be undone.',
        'Delete SLO',
      )
    ) {
      deleteSLO.mutate(sloId, {
        onSuccess: () => {
          notifications.show({
            color: 'green',
            message: 'SLO deleted successfully',
          });
          router.push('/slos');
        },
        onError: () => {
          notifications.show({
            color: 'red',
            message: 'Failed to delete SLO',
          });
        },
      });
    }
  };

  if (isSLOLoading) {
    return <LoadingOverlay visible={true} />;
  }

  if (!slo) {
    return (
      <Container p="md">
        <Text>SLO not found</Text>
      </Container>
    );
  }

  return (
    <Container fluid p="md">
      <Head>
        <title>{slo.sloName} - SLO Details</title>
      </Head>

      <Button
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        onClick={() => router.push('/slos')}
        mb="md"
        color="gray"
      >
        Back to SLOs
      </Button>

      <Group justify="space-between" mb="lg">
        <div>
          <Title order={2}>{slo.sloName}</Title>
          <Text c="dimmed">
            {slo.serviceName} • {slo.metricType}
          </Text>
        </div>
        <Group>
          <TimePicker
            inputValue={displayedTimeInputValue}
            setInputValue={setDisplayedTimeInputValue}
            onSearch={onSearch}
          />
          <Button
            variant="outline"
            color="red"
            leftSection={<IconTrash size={16} />}
            onClick={handleDelete}
          >
            Delete
          </Button>
        </Group>
      </Group>

      <Grid gutter="md">
        <Grid.Col span={4}>
          <Stack>
            {status ? (
              <SLOStatusCard status={status} />
            ) : (
              <Card withBorder p="md">
                <LoadingOverlay visible={isStatusLoading} />
                <Text>Loading status...</Text>
              </Card>
            )}

            <Card withBorder p="md" radius="md">
              <Title order={4} mb="md">
                Configuration
              </Title>
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Target
                  </Text>
                  <Text size="sm" fw={500}>
                    {slo.targetValue}%
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Time Window
                  </Text>
                  <Text size="sm" fw={500}>
                    {slo.timeWindow}
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Metric Type
                  </Text>
                  <Badge variant="light">{slo.metricType}</Badge>
                </Group>
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>

        <Grid.Col span={8}>
          <Card withBorder p="md" radius="md" h="100%">
            <Title order={4} mb="md">
              Burn Rate (Error Budget Consumption)
            </Title>
            <BurnRateChart data={burnRateData} isLoading={isBurnRateLoading} />
          </Card>
        </Grid.Col>
      </Grid>

      <Card withBorder p="md" radius="md" mt="md">
        <Title order={4} mb="md">
          BubbleUp Analysis (Correlations)
        </Title>
        <Text c="dimmed" size="sm" mb="md">
          Comparing "Bad" vs "Good" events over the selected time range to find
          contributing factors.
        </Text>
        <BubbleUpAnalysis
          sloId={sloId}
          timeStart={timeStart}
          timeEnd={timeEnd}
        />
      </Card>
    </Container>
  );
}

export default SLODetailsPage;
