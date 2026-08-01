import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  ApiClient,
  type SourceResponse,
  type SavedSearchResponse,
} from '@/api/client';
import AlertsPage from '@/components/AlertsPage';
import DashboardPage from '@/components/DashboardPage';
import ErrorDisplay from '@/components/ErrorDisplay';
import LoginForm from '@/components/LoginForm';
import SourcePicker from '@/components/SourcePicker';
import EventViewer from '@/components/EventViewer';

type Screen =
  | 'loading'
  | 'login'
  | 'pick-source'
  | 'events'
  | 'alerts'
  | 'dashboards';

interface AppProps {
  appUrl: string;
  /** Pre-set search query from CLI flags */
  query?: string;
  /** Pre-set source name from CLI flags */
  sourceName?: string;
  /** Start in follow/live tail mode */
  follow?: boolean;
}

export default function App({ appUrl, query, sourceName, follow }: AppProps) {
  const [screen, setScreen] = useState<Screen>('loading');
  const [client, setClient] = useState(() => new ApiClient({ appUrl }));
  const [currentAppUrl, setCurrentAppUrl] = useState(appUrl);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [eventSources, setLogSources] = useState<SourceResponse[]>([]);
  // All sources (incl. metric/session) — dashboard tiles may reference any kind
  const [allSources, setAllSources] = useState<SourceResponse[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearchResponse[]>([]);
  const [selectedSource, setSelectedSource] = useState<SourceResponse | null>(
    null,
  );
  const [activeQuery, setActiveQuery] = useState(query ?? '');
  const [error, setError] = useState<string | null>(null);

  // Stable ClickHouse client + metadata instances — recreating them on
  // every render would re-trigger data-fetch effects downstream (each
  // effect aborts its in-flight query when its deps change).
  const clickhouseClient = useMemo(
    () => client.createClickHouseClient(),
    [client],
  );
  const metadata = useMemo(() => client.createMetadata(), [client]);

  // Check existing session on mount
  useEffect(() => {
    (async () => {
      const valid = await client.checkSession();
      if (valid) {
        await loadData(client);
      } else {
        setSessionExpired(true);
        setScreen('login');
      }
    })();
  }, []);

  const loadData = async (apiClient: ApiClient) => {
    try {
      const [sources, searches] = await Promise.all([
        apiClient.getSources(),
        apiClient.getSavedSearches().catch(() => [] as SavedSearchResponse[]),
      ]);

      setAllSources(sources);

      const queryableSources = sources.filter(
        s => s.kind === SourceKind.Log || s.kind === SourceKind.Trace,
      );

      if (queryableSources.length === 0) {
        setError(
          'No log or trace sources found. Configure a source in HyperDX first.',
        );
        return;
      }

      setLogSources(queryableSources);
      setSavedSearches(searches);

      // Auto-select if source name was provided via CLI
      if (sourceName) {
        const match = queryableSources.find(
          s => s.name.toLowerCase() === sourceName.toLowerCase(),
        );
        if (match) {
          setSelectedSource(match);
          setScreen('events');
          return;
        }
      }

      // Auto-select if only one source
      if (queryableSources.length === 1) {
        setSelectedSource(queryableSources[0]);
        setScreen('events');
        return;
      }

      setScreen('pick-source');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Treat auth errors as session issues — bounce back to login
      if (msg.includes('401') || msg.includes('403')) {
        setSessionExpired(true);
        setScreen('login');
        return;
      }
      setError(msg);
    }
  };

  const handleLogin = async (
    loginAppUrl: string,
    email: string,
    password: string,
  ): Promise<string | null> => {
    // Recreate client if the user changed the URL
    let activeClient = client;
    if (loginAppUrl !== currentAppUrl) {
      activeClient = new ApiClient({ appUrl: loginAppUrl });
      setClient(activeClient);
      setCurrentAppUrl(loginAppUrl);
    }

    const loginError = await activeClient.login(email, password);
    if (!loginError) {
      setSessionExpired(false);
      await loadData(activeClient);
    }
    return loginError;
  };

  const handleSourceSelect = (source: SourceResponse) => {
    setSelectedSource(source);
    setScreen('events');
  };

  const handleSavedSearchSelect = useCallback(
    (search: SavedSearchResponse) => {
      const source = eventSources.find(
        s => s.id === search.source || s._id === search.source,
      );
      if (source) {
        setSelectedSource(source);
      }
      setActiveQuery(search.where);
      setScreen('events');
    },
    [eventSources],
  );

  // Track the screen before alerts/dashboards so we can return to it
  const [preOverlayScreen, setPreOverlayScreen] = useState<Screen>('events');

  const handleOpenAlerts = useCallback(() => {
    setPreOverlayScreen(screen);
    setScreen('alerts');
  }, [screen]);

  const handleCloseAlerts = useCallback(() => {
    setScreen(preOverlayScreen);
  }, [preOverlayScreen]);

  const handleOpenDashboards = useCallback(() => {
    setPreOverlayScreen(screen);
    setScreen('dashboards');
  }, [screen]);

  const handleCloseDashboards = useCallback(() => {
    setScreen(preOverlayScreen);
  }, [preOverlayScreen]);

  if (error) {
    return (
      <Box paddingX={1}>
        <ErrorDisplay error={error} severity="error" />
      </Box>
    );
  }

  switch (screen) {
    case 'loading':
      return (
        <Box paddingX={1}>
          <Text>
            <Spinner type="dots" /> Connecting to {currentAppUrl}…
          </Text>
        </Box>
      );

    case 'login':
      return (
        <LoginForm
          defaultAppUrl={currentAppUrl}
          onLogin={handleLogin}
          message={
            sessionExpired
              ? 'Session expired — please log in again.'
              : undefined
          }
        />
      );

    case 'pick-source':
      return (
        <Box flexDirection="column">
          <Box flexDirection="column" marginBottom={1}>
            <Text color="#00c28a" bold>
              HyperDX TUI
            </Text>
            <Text dimColor>Search and tail events from the terminal</Text>
          </Box>
          <SourcePicker
            sources={eventSources}
            onSelect={handleSourceSelect}
            onOpenAlerts={handleOpenAlerts}
            onOpenDashboards={handleOpenDashboards}
          />
        </Box>
      );

    case 'alerts':
      return <AlertsPage client={client} onClose={handleCloseAlerts} />;

    case 'dashboards':
      return (
        <DashboardPage
          client={client}
          clickhouseClient={clickhouseClient}
          metadata={metadata}
          sources={allSources}
          onClose={handleCloseDashboards}
        />
      );

    case 'events':
      if (!selectedSource) return null;
      return (
        <EventViewer
          clickhouseClient={clickhouseClient}
          metadata={metadata}
          appUrl={currentAppUrl}
          source={selectedSource}
          sources={eventSources}
          savedSearches={savedSearches}
          onSavedSearchSelect={handleSavedSearchSelect}
          onOpenAlerts={handleOpenAlerts}
          onOpenDashboards={handleOpenDashboards}
          initialQuery={activeQuery}
          follow={follow}
        />
      );
  }
}
