import { ReactNode, useCallback, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Box, Center, Container, Loader, Stack, Tabs } from '@mantine/core';

import { PageHeader } from './components/PageHeader';
import ApiKeysSection from './components/TeamSettings/ApiKeysSection';
import ConnectionsSection from './components/TeamSettings/ConnectionsSection';
import IntegrationsSection from './components/TeamSettings/IntegrationsSection';
import SecurityPoliciesSection from './components/TeamSettings/SecurityPoliciesSection';
import SourcesSection from './components/TeamSettings/SourcesSection';
import TeamMembersSection from './components/TeamSettings/TeamMembersSection';
import TeamNameSection from './components/TeamSettings/TeamNameSection';
import TeamQueryConfigSection from './components/TeamSettings/TeamQueryConfigSection';
import { useBrandDisplayName } from './theme/ThemeProvider';
import api from './api';
import { withAppNav } from './layout';

type TeamTab = {
  value: string;
  label: string;
  sections: {
    id: string;
    content: ReactNode;
  }[];
};

function TeamTabContent({ sections }: { sections: TeamTab['sections'] }) {
  return (
    <Stack gap="lg" pt="lg">
      {sections.map(section => (
        <Box key={section.id} id={section.id}>
          {section.content}
        </Box>
      ))}
    </Stack>
  );
}

export default function TeamPage() {
  const brandName = useBrandDisplayName();
  const router = useRouter();
  const { data: team, isLoading } = api.useTeam();
  const allowedAuthMethods = team?.allowedAuthMethods ?? [];
  const hasAllowedAuthMethods = allowedAuthMethods.length > 0;

  const tabs: TeamTab[] = [
    {
      value: 'data',
      label: 'Data',
      sections: [
        {
          id: 'team-data-sources',
          content: <SourcesSection />,
        },
        {
          id: 'team-data-connections',
          content: <ConnectionsSection />,
        },
      ],
    },
    {
      value: 'team',
      label: 'Team',
      sections: [
        {
          id: 'team-name',
          content: <TeamNameSection />,
        },
        {
          id: 'team-members',
          content: <TeamMembersSection />,
        },
      ],
    },
    ...(hasAllowedAuthMethods
      ? [
          {
            value: 'access',
            label: 'Access',
            sections: [
              {
                id: 'team-access-security-policies',
                content: (
                  <SecurityPoliciesSection
                    allowedAuthMethods={allowedAuthMethods}
                  />
                ),
              },
            ],
          },
        ]
      : []),
    {
      value: 'integrations',
      label: 'Integrations',
      sections: [
        {
          id: 'team-integrations-webhooks',
          content: <IntegrationsSection />,
        },
        {
          id: 'team-integrations-api-keys',
          content: <ApiKeysSection />,
        },
      ],
    },
    {
      value: 'advanced',
      label: 'Advanced',
      sections: [
        {
          id: 'team-advanced-query-settings',
          content: <TeamQueryConfigSection />,
        },
      ],
    },
  ];

  const queryTab =
    typeof router.query.tab === 'string' ? router.query.tab : null;
  const activeTab = tabs.some(tab => tab.value === queryTab)
    ? queryTab
    : tabs[0]?.value;

  useEffect(() => {
    if (!router.isReady || !activeTab || queryTab === activeTab) {
      return;
    }

    void router.replace(
      {
        pathname: router.pathname,
        query: {
          ...router.query,
          tab: activeTab,
        },
      },
      undefined,
      {
        shallow: true,
        scroll: false,
      },
    );
  }, [activeTab, queryTab, router]);

  const handleTabChange = useCallback(
    (value: string | null) => {
      if (!value || value === activeTab) {
        return;
      }

      document.getElementById('app-content-scroll-container')?.scrollTo({
        top: 0,
      });

      void router.replace(
        {
          pathname: router.pathname,
          query: {
            ...router.query,
            tab: value,
          },
        },
        undefined,
        {
          shallow: true,
          scroll: false,
        },
      );
    },
    [activeTab, router],
  );

  return (
    <div className="TeamPage" data-testid="team-page">
      <Head>
        <title>My Team - {brandName}</title>
      </Head>
      <PageHeader>
        <div>{team?.name || 'My team'}</div>
      </PageHeader>
      <div>
        <Container size="lg" py="md">
          {isLoading && (
            <Center mt="xl">
              <Loader color="dimmed" />
            </Center>
          )}
          {!isLoading && team != null && (
            <Tabs value={activeTab} onChange={handleTabChange}>
              <Tabs.List>
                {tabs.map(tab => (
                  <Tabs.Tab key={tab.value} value={tab.value}>
                    {tab.label}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
              {tabs.map(tab => (
                <Tabs.Panel key={tab.value} value={tab.value}>
                  <TeamTabContent sections={tab.sections} />
                </Tabs.Panel>
              ))}
            </Tabs>
          )}
        </Container>
      </div>
    </div>
  );
}

TeamPage.getLayout = withAppNav;
