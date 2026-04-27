import { useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  Anchor,
  Breadcrumbs,
  Button,
  Card,
  Container,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { IconUpload } from '@tabler/icons-react';

import { DASHBOARD_TEMPLATES } from '@/dashboardTemplates';
import { useBrandDisplayName } from '@/theme/ThemeProvider';

import { withAppNav } from '../../layout';

export default function DashboardTemplatesPage() {
  const brandName = useBrandDisplayName();

  const templatesByTag = useMemo(() => {
    const groups = new Map<string, typeof DASHBOARD_TEMPLATES>();
    for (const t of DASHBOARD_TEMPLATES) {
      const tags = t.tags.length > 0 ? t.tags : ['Other'];
      for (const tag of tags) {
        const group = groups.get(tag) ?? [];
        group.push(t);
        groups.set(tag, group);
      }
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([tag, items]) =>
          [
            tag,
            items.slice().sort((a, b) => a.name.localeCompare(b.name)),
          ] as const,
      );
  }, []);

  return (
    <div data-testid="dashboard-templates-page">
      <Head>
        <title>Dashboard Templates - {brandName}</title>
      </Head>
      <Breadcrumbs my="lg" ms="xs" fz="sm">
        <Anchor component={Link} href="/dashboards/list" fz="sm" c="dimmed">
          Dashboards
        </Anchor>
        <Text fz="sm" c="dimmed">
          Templates
        </Text>
      </Breadcrumbs>
      <Container maw={1200} py="lg" px="lg">
        <Stack gap="xl">
          {templatesByTag.map(([tag, templates]) => (
            <div key={tag}>
              <Text fw={500} size="sm" c="dimmed" mb="sm">
                {tag}
              </Text>
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
                {templates.map(t => (
                  <Card key={t.id} withBorder padding="lg" radius="sm">
                    <Stack justify="space-between" h="100%">
                      <Stack>
                        <Text
                          fw={500}
                          lineClamp={1}
                          mb="xs"
                          style={{ minWidth: 0 }}
                          title={t.name}
                        >
                          {t.name}
                        </Text>
                        <Text size="sm" c="dimmed">
                          {t.description}
                        </Text>
                      </Stack>
                      <Button
                        component={Link}
                        href={`/dashboards/import?template=${t.id}`}
                        variant="secondary"
                        leftSection={<IconUpload size={16} />}
                        mt="md"
                        size="xs"
                        data-testid={`import-template-${t.id}`}
                      >
                        Import
                      </Button>
                    </Stack>
                  </Card>
                ))}
              </SimpleGrid>
            </div>
          ))}
        </Stack>
      </Container>
    </div>
  );
}

DashboardTemplatesPage.getLayout = withAppNav;
