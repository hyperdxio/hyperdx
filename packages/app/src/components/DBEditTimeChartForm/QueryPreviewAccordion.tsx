import { ReactNode } from 'react';
import { Accordion, Box, Text, Tooltip } from '@mantine/core';
import { IconCode } from '@tabler/icons-react';

/** The collapsed accordion the preview panel shows a tile's query in. */
export function QueryPreviewAccordion({
  value,
  label,
  disabledReason,
  children,
}: {
  /** The accordion item's key — arbitrary, but it must be non-empty. */
  value: string;
  label: string;
  /** Why there is nothing to show. Set means the control is disabled. */
  disabledReason?: string;
  children: ReactNode;
}) {
  const isDisabled = disabledReason != null;

  return (
    <Accordion defaultValue="">
      <Accordion.Item value={value}>
        {/* The tooltip hangs off the wrapper Box rather than the control itself
         * because a disabled Accordion.Control emits none of the pointer events
         * that would open it*/}
        <Tooltip
          label={disabledReason}
          disabled={!isDisabled}
          position="top-start"
        >
          <Box>
            <Accordion.Control
              icon={<IconCode size={16} />}
              disabled={isDisabled}
              style={isDisabled ? { pointerEvents: 'none' } : undefined}
            >
              <Text size="sm" style={{ alignSelf: 'center' }}>
                {label}
              </Text>
            </Accordion.Control>
          </Box>
        </Tooltip>
        <Accordion.Panel>{isDisabled ? null : children}</Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
