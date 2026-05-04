import { useMemo } from 'react';
import Head from 'next/head';
import {
  Anchor,
  Avatar,
  Card,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location: { name: string };
  updated_at: string;
  departments: { id: number; name: string }[];
  content: string;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

interface GitHubCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
  author: {
    login: string;
    avatar_url: string;
  } | null;
}

const GITHUB_COMMITS_URL =
  'https://api.github.com/repos/hyperdxio/hyperdx/commits?sha=main&per_page=50';

const GREENHOUSE_API_URL =
  'https://boards-api.greenhouse.io/v1/boards/clickhouse/jobs';

const FILTER_PATTERN = /hyperdx|clickstack/i;

function useRecentCommits() {
  return useQuery<GitHubCommit[]>({
    queryKey: ['github-commits'],
    queryFn: async () => {
      const res = await fetch(GITHUB_COMMITS_URL);
      if (!res.ok) {
        throw new Error('Failed to fetch commits');
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useGreenhouseJobs() {
  return useQuery<GreenhouseResponse>({
    queryKey: ['greenhouse-jobs'],
    queryFn: async () => {
      const res = await fetch(GREENHOUSE_API_URL);
      if (!res.ok) {
        throw new Error('Failed to fetch job listings');
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

export default function CareersPage() {
  const { data: commitsData, isLoading: commitsLoading } = useRecentCommits();
  const { data, isLoading, isError } = useGreenhouseJobs();

  const filteredJobs = useMemo(() => {
    if (!data?.jobs) return [];
    return data.jobs.filter(job => FILTER_PATTERN.test(job.title));
  }, [data]);

  return (
    <Container size="md" py="xl">
      <Head>
        <title>Careers | HyperDX</title>
      </Head>
      <Stack gap="lg">
        <Title order={1}>
          ClickHouse Careers: Help Build the Future of Observability
        </Title>
        <Text c="dimmed">
          Join us to build ClickStack at ClickHouse, scaling a high performance
          observability platform that ingests and queries petabytes of telemetry
          across metrics, logs, and traces.
          <br />
          <br />
          Open positions are listed below.
        </Text>

        {isLoading && <Loader />}

        {isError && (
          <Text c="red">
            Unable to load job listings. Please try again later.
          </Text>
        )}

        {!isLoading && !isError && filteredJobs.length === 0 && (
          <Text c="dimmed">
            No open positions at the moment. Check back soon!
          </Text>
        )}

        {filteredJobs.map(job => (
          <Anchor
            key={job.id}
            href={job.absolute_url}
            target="_blank"
            rel="noopener noreferrer"
            underline="never"
          >
            <Card withBorder padding="lg" style={{ cursor: 'pointer' }}>
              <div>
                <Text
                  fw={600}
                  size="lg"
                  c="var(--mantine-primary-color-light-color)"
                >
                  {job.title}
                </Text>
                <Text c="dimmed" size="sm">
                  {job.location.name}
                </Text>
              </div>
            </Card>
          </Anchor>
        ))}

        <Title order={3} mt="xl">
          Recent Activity
        </Title>
        <Text c="dimmed" size="sm">
          See what types of problems our team (and community) have been working
          on lately.
        </Text>

        {commitsLoading && <Loader size="sm" />}

        {commitsData?.map(commit => (
          <Anchor
            key={commit.sha}
            href={commit.html_url}
            target="_blank"
            rel="noopener noreferrer"
            underline="never"
          >
            <Card withBorder padding="sm" style={{ cursor: 'pointer' }}>
              <Group gap="sm" wrap="nowrap">
                <Avatar src={commit.author?.avatar_url} size="sm" radius="xl" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text size="sm" truncate>
                    {commit.commit.message.split('\n')[0]}
                  </Text>
                  <Group gap="xs">
                    <Text c="dimmed" size="xs">
                      {commit.author?.login ?? commit.commit.author.name}
                    </Text>
                    <Text c="dimmed" size="xs">
                      {new Date(commit.commit.author.date).toLocaleDateString()}
                    </Text>
                  </Group>
                </div>
              </Group>
            </Card>
          </Anchor>
        ))}
      </Stack>
    </Container>
  );
}
