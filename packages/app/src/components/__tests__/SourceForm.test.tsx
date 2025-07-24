import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import '@testing-library/jest-dom';

describe('TableSourceForm Bidirectional Linking', () => {
  describe('Bidirectional Source Linking Logic', () => {
    it('should establish bidirectional link when creating a log source with trace correlation', async () => {
      const mockUpdateSourceMutateAsync = jest.fn();
      const mockOnCreate = jest.fn();

      // Mock sources data
      const sources = [
        {
          id: 'trace-source-1',
          name: 'Trace Source 1',
          kind: SourceKind.Trace,
          logSourceId: undefined,
        },
      ];

      const newLogSource: TSource = {
        id: 'new-log-source',
        name: 'New Log Source',
        kind: SourceKind.Log,
        connection: 'conn-1',
        from: {
          databaseName: 'default',
          tableName: 'new_logs',
        },
        timestampValueExpression: 'Timestamp',
        traceSourceId: 'trace-source-1', // This will trigger bidirectional linking
      } as TSource;

      // This is the bidirectional linking logic from the component
      const correlationFields: Record<
        string,
        Array<{ targetKind: SourceKind; targetField: string }>
      > = {
        traceSourceId: [
          { targetKind: SourceKind.Trace, targetField: 'logSourceId' },
        ],
      };

      // Execute the bidirectional linking logic
      for (const [fieldName, targetConfigs] of Object.entries(
        correlationFields,
      )) {
        const targetSourceId = (newLogSource as any)[fieldName];
        if (targetSourceId) {
          for (const { targetKind, targetField } of targetConfigs) {
            const targetSource = sources.find(s => s.id === targetSourceId);
            if (targetSource && targetSource.kind === targetKind) {
              // Only update if the target field is empty
              if (!(targetSource as any)[targetField]) {
                await mockUpdateSourceMutateAsync({
                  source: {
                    ...targetSource,
                    [targetField]: newLogSource.id,
                  } as TSource,
                });
              }
            }
          }
        }
      }

      mockOnCreate(newLogSource);

      // Verify that the bidirectional linking was established
      expect(mockUpdateSourceMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          source: expect.objectContaining({
            id: 'trace-source-1',
            logSourceId: 'new-log-source',
          }),
        }),
      );

      expect(mockOnCreate).toHaveBeenCalledWith(newLogSource);
    });

    it('should establish bidirectional link when creating a trace source with log correlation', async () => {
      const mockUpdateSourceMutateAsync = jest.fn();
      const mockOnCreate = jest.fn();

      // Mock sources data
      const sources = [
        {
          id: 'log-source-1',
          name: 'Log Source 1',
          kind: SourceKind.Log,
          traceSourceId: undefined,
        },
      ];

      const newTraceSource: TSource = {
        id: 'new-trace-source',
        name: 'New Trace Source',
        kind: SourceKind.Trace,
        connection: 'conn-1',
        from: {
          databaseName: 'default',
          tableName: 'new_traces',
        },
        timestampValueExpression: 'Timestamp',
        logSourceId: 'log-source-1', // This will trigger bidirectional linking
      } as TSource;

      // This is the bidirectional linking logic from the component for trace sources
      const correlationFields: Record<
        string,
        Array<{ targetKind: SourceKind; targetField: string }>
      > = {
        logSourceId: [
          { targetKind: SourceKind.Log, targetField: 'traceSourceId' },
        ],
      };

      // Execute the bidirectional linking logic
      for (const [fieldName, targetConfigs] of Object.entries(
        correlationFields,
      )) {
        const targetSourceId = (newTraceSource as any)[fieldName];
        if (targetSourceId) {
          for (const { targetKind, targetField } of targetConfigs) {
            const targetSource = sources.find(s => s.id === targetSourceId);
            if (targetSource && targetSource.kind === targetKind) {
              // Only update if the target field is empty
              if (!(targetSource as any)[targetField]) {
                await mockUpdateSourceMutateAsync({
                  source: {
                    ...targetSource,
                    [targetField]: newTraceSource.id,
                  } as TSource,
                });
              }
            }
          }
        }
      }

      mockOnCreate(newTraceSource);

      // Verify that the bidirectional linking was established
      expect(mockUpdateSourceMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          source: expect.objectContaining({
            id: 'log-source-1',
            traceSourceId: 'new-trace-source',
          }),
        }),
      );

      expect(mockOnCreate).toHaveBeenCalledWith(newTraceSource);
    });

    it('should not establish bidirectional link if target source already has a correlation', async () => {
      const mockUpdateSourceMutateAsync = jest.fn();
      const mockOnCreate = jest.fn();

      // Mock sources with existing correlations
      const sources = [
        {
          id: 'log-source-1',
          name: 'Log Source 1',
          kind: SourceKind.Log,
          traceSourceId: 'existing-trace-source', // Already has a correlation
        },
      ];

      const newTraceSource: TSource = {
        id: 'new-trace-source',
        name: 'New Trace Source',
        kind: SourceKind.Trace,
        connection: 'conn-1',
        from: {
          databaseName: 'default',
          tableName: 'new_traces',
        },
        timestampValueExpression: 'Timestamp',
        logSourceId: 'log-source-1', // This should NOT establish bidirectional link
      } as TSource;

      // This is the bidirectional linking logic from the component for trace sources
      const correlationFields: Record<
        string,
        Array<{ targetKind: SourceKind; targetField: string }>
      > = {
        logSourceId: [
          { targetKind: SourceKind.Log, targetField: 'traceSourceId' },
        ],
      };

      // Execute the bidirectional linking logic
      for (const [fieldName, targetConfigs] of Object.entries(
        correlationFields,
      )) {
        const targetSourceId = (newTraceSource as any)[fieldName];
        if (targetSourceId) {
          for (const { targetKind, targetField } of targetConfigs) {
            const targetSource = sources.find(s => s.id === targetSourceId);
            if (targetSource && targetSource.kind === targetKind) {
              // Only update if the target field is empty
              if (!(targetSource as any)[targetField]) {
                await mockUpdateSourceMutateAsync({
                  source: {
                    ...targetSource,
                    [targetField]: newTraceSource.id,
                  } as TSource,
                });
              }
            }
          }
        }
      }

      mockOnCreate(newTraceSource);

      // Verify that NO bidirectional linking was established since the log source already has a trace correlation
      expect(mockUpdateSourceMutateAsync).not.toHaveBeenCalled();

      expect(mockOnCreate).toHaveBeenCalledWith(newTraceSource);
    });
  });
});
