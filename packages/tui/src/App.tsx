import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  ApiClient,
  type SourceResponse,
  type SavedSearchResponse,
} from '@/api/client';
import LoginForm from '@/components/LoginForm';
import SourcePicker from '@/components/SourcePicker';
import EventViewer from '@/components/EventViewer';

type Screen = 'loading' | 'login' | 'pick-source' | 'events';

interface AppProps {
  apiUrl: string;
  /** Pre-set search query from CLI flags */
  query?: string;
  /** Pre-set source name from CLI flags */
  sourceName?: string;
  /** Start in autoscroll/live tail mode */
  autoScroll?: boolean;
}

export default function App({
  apiUrl,
  query,
  sourceName,
  autoScroll,
}: AppProps) {
  const [screen, setScreen] = useState<Screen>('loading');
  const [client] = useState(() => new ApiClient({ apiUrl }));
  const [eventSources, setLogSources] = useState<SourceResponse[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearchResponse[]>([]);
  const [selectedSource, setSelectedSource] = useState<SourceResponse | null>(
    null,
  );
  const [activeQuery, setActiveQuery] = useState(query ?? '');
  const [error, setError] = useState<string | null>(null);

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

  if (error) {
    return (
      <Box paddingX={1}>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

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
        <SourcePicker sources={eventSources} onSelect={handleSourceSelect} />
      );

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
          initialQuery={activeQuery}
          autoScroll={autoScroll}
        />
      );
  }
}
