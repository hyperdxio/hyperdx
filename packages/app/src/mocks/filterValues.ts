import { useEffect, useState } from 'react';

export const MOCK_SQL_VALUES: Record<string, string[]> = {
  ServiceName: ['checkout', 'frontend', 'payment', 'cart', 'shipping'],
  SeverityText: ['debug', 'info', 'warn', 'error', 'fatal'],
  StatusCode: ['200', '201', '301', '400', '404', '500', '503'],
  "LogAttributes['http.method']": ['GET', 'POST', 'PUT', 'DELETE'],
  "ResourceAttributes['k8s.namespace.name']": ['default', 'otel', 'prod'],
};

export const MOCK_PROMQL_VALUES: Record<string, string[]> = {
  job: ['api', 'node-exporter', 'otel-collector'],
  instance: ['10.0.0.1:9100', '10.0.0.2:9100', '10.0.0.3:9100'],
  namespace: ['default', 'otel', 'prod'],
  status_code: ['200', '404', '500'],
};

/** Serves mock values for a key after a delay, like a metadata query. */
export function useMockValues(
  values: Record<string, string[]>,
  key: string,
  delayMs = 400,
) {
  const [state, setState] = useState<{ key: string; data: string[] }>({
    key: '',
    data: [],
  });
  useEffect(() => {
    if (!key) return;
    const timer = setTimeout(
      () => setState({ key, data: values[key] ?? [] }),
      delayMs,
    );
    return () => clearTimeout(timer);
  }, [values, key, delayMs]);
  const isLoading = !!key && state.key !== key;
  return { data: isLoading ? [] : state.data, isLoading };
}
