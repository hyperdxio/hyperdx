import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import Spinner from 'ink-spinner';

import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  ApiClient,
  type SourceResponse,
  type SavedSearchResponse,
} from '@/api/client';
import AlertsPage from '@/components/AlertsPage';
import ErrorDisplay from '@/components/ErrorDisplay';
import LoginForm from '@/components/LoginForm';
import SourcePicker from '@/components/SourcePicker';
import Spotlight, {
  buildSpotlightItems,
  type SpotlightItem,
} from '@/components/Spotlight';
import EventViewer from '@/components/EventViewer';

type Screen = 'loading' | 'login' | 'pick-source' | 'events' | 'alerts';

interface AppProps {
  apiUrl: string;
  /** Pre-set search query from CLI flags */
  query?: string;
  /** Pre-set source name from CLI flags */
  sourceName?: string;
  /** Start in follow/live tail mode */
  follow?: boolean;
}

export default function App({ apiUrl, query, sourceName, follow }: AppProps) {
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;

  const [screen, setScreen] = useState<Screen>('loading');
  const [client] = useState(() => new ApiClient({ apiUrl }));
  const [eventSources, setLogSources] = useState<SourceResponse[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearchResponse[]>([]);
  const [selectedSource, setSelectedSource] = useState<SourceResponse | null>(
    null,
  );
  const [activeQuery, setActiveQuery] = useState(query ?? '');
  const [error, setError] = useState<string | null>(null);
  const [showSpotlight, setShowSpotlight] = useState(false);

  // Check existing session on mount
  useEffect(() => {
    (async () => {
      const valid = await client.checkSession();
      if (valid) {
        await loadData();
      } else {
        setScreen('login');
      }
    })();
  }, []);

  const loadData = async () => {
    try {
      const [sources, searches] = await Promise.all([
        client.getSources(),
        client.getSavedSearches().catch(() => [] as SavedSearchResponse[]),
      ]);

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
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLogin = async (email: string, password: string) => {
    const ok = await client.login(email, password);
    if (ok) {
      await loadData();
    }
    return ok;
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

  // Track the screen before alerts so we can return to it
  const [preAlertsScreen, setPreAlertsScreen] = useState<Screen>('events');

  const handleOpenAlerts = useCallback(() => {
    setPreAlertsScreen(screen);
    setScreen('alerts');
  }, [screen]);

  const handleCloseAlerts = useCallback(() => {
    setScreen(preAlertsScreen);
  }, [preAlertsScreen]);

  // ---- Spotlight (Ctrl+K) --------------------------------------------

  const spotlightItems = useMemo(
    () => buildSpotlightItems(eventSources, savedSearches),
    [eventSources, savedSearches],
  );

  const handleOpenSpotlight = useCallback(() => {
    setShowSpotlight(true);
  }, []);

  const handleCloseSpotlight = useCallback(() => {
    setShowSpotlight(false);
  }, []);

  const handleSpotlightSelect = useCallback(
    (item: SpotlightItem) => {
      setShowSpotlight(false);
      switch (item.type) {
        case 'source':
          if (item.source) {
            setSelectedSource(item.source);
            setActiveQuery('');
            setScreen('events');
          }
          break;
        case 'saved-search':
          if (item.search) {
            const source = eventSources.find(
              s => s.id === item.search!.source || s._id === item.search!.source,
            );
            if (source) {
              setSelectedSource(source);
            }
            setActiveQuery(item.search.where);
            setScreen('events');
          }
          break;
        case 'page':
          if (item.page === 'alerts') {
            handleOpenAlerts();
          }
          break;
      }
    },
    [eventSources, handleOpenAlerts],
  );

  if (error) {
    return (
      <Box paddingX={1}>
        <ErrorDisplay error={error} severity="error" />
      </Box>
    );
  }

  const renderScreen = () => {
    switch (screen) {
      case 'loading':
        return (
          <Box paddingX={1}>
            <Text>
              <Spinner type="dots" /> Connecting to {apiUrl}…
            </Text>
          </Box>
        );

      case 'login':
        return <LoginForm apiUrl={apiUrl} onLogin={handleLogin} />;

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
              onOpenSpotlight={handleOpenSpotlight}
            />
          </Box>
        );

      case 'alerts':
        return <AlertsPage client={client} onClose={handleCloseAlerts} />;

      case 'events':
        if (!selectedSource) return null;
        return (
          <EventViewer
            clickhouseClient={client.createClickHouseClient()}
            metadata={client.createMetadata()}
            source={selectedSource}
            sources={eventSources}
            savedSearches={savedSearches}
            onSavedSearchSelect={handleSavedSearchSelect}
            onOpenAlerts={handleOpenAlerts}
            onOpenSpotlight={handleOpenSpotlight}
            initialQuery={activeQuery}
            follow={follow}
          />
        );
    }
  };

  if (showSpotlight) {
    return (
      <Box flexDirection="column" height={termHeight}>
        <Spotlight
          items={spotlightItems}
          onSelect={handleSpotlightSelect}
          onClose={handleCloseSpotlight}
        />
      </Box>
    );
  }

  return renderScreen();
}
