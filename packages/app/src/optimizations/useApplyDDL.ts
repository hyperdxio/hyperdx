import { TSource } from '@hyperdx/common-utils/dist/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useClickhouseClient } from '@/clickhouse';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import { metadataQueryKeys } from '@/hooks/useMetadata';

// Join a list of DDL statements into a single SQL script suitable for display
// or copy-to-clipboard. ClickHouse rejects multi-statement queries by default,
// so we never send the joined form over the wire — only render it.
export function joinDDL(statements: string[]): string {
  return statements.map(s => `${s.trimEnd()};`).join('\n\n');
}

/**
 * Generic one-click DDL apply against a source's connection.
 *
 * Each statement is executed as its own ClickHouse query (the server rejects
 * multi-statement queries by default). On success, busts the per-table
 * metadata cache (in-memory + TanStack Query) so re-running detection sees
 * the freshly-applied schema.
 */
export function useApplyDDL(source: TSource | undefined) {
  const clickhouseClient = useClickhouseClient();
  const metadata = useMetadataWithSettings();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ statements }: { statements: string[] }) => {
      if (!source) throw new Error('No source provided');
      for (const statement of statements) {
        const result = await clickhouseClient.query({
          query: statement,
          connectionId: source.connection,
          format: 'JSON',
        });
        // Drain to surface any server-side error before moving to the next.
        await result.text();
      }
    },
    onSuccess: () => {
      if (!source) return;
      const { databaseName, tableName } = source.from;
      metadata.invalidateTable({
        connectionId: source.connection,
        databaseName,
        tableName,
      });
      queryClient.invalidateQueries({
        queryKey: metadataQueryKeys.tableMetadata({ databaseName, tableName }),
      });
      queryClient.invalidateQueries({
        queryKey: metadataQueryKeys.columns({ databaseName, tableName }),
      });
      queryClient.invalidateQueries({ queryKey: ['optimization'] });
    },
  });
}
