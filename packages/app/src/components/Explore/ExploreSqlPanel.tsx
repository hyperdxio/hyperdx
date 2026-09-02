import { UseControllerProps } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { isMissingFiltersMacro } from '@hyperdx/common-utils/dist/macros';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Alert, Box, Button, CopyButton, Group, Text } from '@mantine/core';
import { IconCheck, IconCopy, IconRestore } from '@tabler/icons-react';

import { useConfirm } from '@/useConfirm';

import { ExploreRawSqlEditor } from './ExploreRawSqlEditor';

export type ExploreSqlPanelProps = {
  tableConnections: TableConnection[];
  displayType?: DisplayType;
  dateRange?: [Date, Date];
  timestampValueExpression?: string;
  onSubmit?: () => void;
  /** Current template text — drives copy and the macro check. */
  sqlTemplate: string;
  /**
   * True once the user has taken the query over from the generator. Until then
   * the text is regenerated from the search above and nothing here is at risk.
   */
  edited: boolean;
  /**
   * Fired when the user types. Receives the new text so the caller can ignore
   * echoes of its own regeneration.
   */
  onEdit?: (value: string) => void;
  /** Hand the query back to the generator, discarding hand edits. */
  onReset: () => void;
} & UseControllerProps<any>;

/**
 * The SQL half of the Explore query editor: a full-statement editor that is
 * editable from the moment it opens. While it is generated it mirrors the
 * search above; the first keystroke hands ownership to the user, which is when
 * Reset and the dropped-filters warning start to matter.
 *
 * The disclosure button that opens this panel carries the generated/edited
 * status, so the panel deliberately has no header of its own.
 */
export function ExploreSqlPanel({
  sqlTemplate,
  edited,
  onEdit,
  onReset,
  ...editorProps
}: ExploreSqlPanelProps) {
  const confirm = useConfirm();

  // Only worth warning about once the query is the user's: a generated
  // template always carries the macro.
  const filtersDropped = edited && isMissingFiltersMacro(sqlTemplate);

  const handleReset = async () => {
    const ok = await confirm(
      'Discard your SQL edits and go back to the query generated from the search?',
      'Reset',
    );
    if (ok) {
      onReset();
    }
  };

  return (
    <Box data-testid="explore-sql-panel">
      {filtersDropped && (
        <Alert variant="warning" p="xs" mb={6}>
          <Text size="xs">
            This query no longer uses{' '}
            <Text span ff="monospace" fz="xs">
              $__filters
            </Text>
            , so the search box and filter pills above do not apply to it. Add
            the macro back to the WHERE clause, or reset to the generated query.
          </Text>
        </Alert>
      )}
      <ExploreRawSqlEditor
        {...editorProps}
        onValueChange={onEdit}
        headerActions={
          <Group gap={4} wrap="nowrap">
            <CopyButton value={sqlTemplate} timeout={1500}>
              {({ copied, copy }) => (
                <Button
                  variant="subtle"
                  size="compact-xs"
                  onClick={copy}
                  leftSection={
                    copied ? <IconCheck size={14} /> : <IconCopy size={14} />
                  }
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
            </CopyButton>
            {edited && (
              <Button
                variant="subtle"
                size="compact-xs"
                leftSection={<IconRestore size={14} />}
                onClick={handleReset}
              >
                Reset to generated
              </Button>
            )}
          </Group>
        }
      />
    </Box>
  );
}
