import { DownChevron } from 'react-select/dist/declarations/src/components/indicators';
import { Button, Collapse, Flex, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';

interface DBSearchSharedFiltersProps {
  isEnabled?: boolean;
}

export default function DBSearchSharedFilters({
  isEnabled = true,
}: DBSearchSharedFiltersProps) {
  const [opened, openState] = useDisclosure(true);

  if (!isEnabled) {
    return null;
  }

  return (
    <>
      {/* <Accordion.Control
              component={UnstyledButton}
              flex="1"
              p="0"
              data-testid="filter-group-control"
              classNames={{
                chevron: 'm-0',
                label: 'p-0',
              }}
              style={{ overflow: 'hidden' }}
              className={displayedOptions.length ? '' : 'opacity-50'}
            ></Accordion.Control>
             */}

      <UnstyledButton onClick={openState.toggle}>
        <Text size="xxs" c="dimmed" fw="bold">
          <Flex align="center" justify="space-between">
            Shared Filters
            <IconChevronDown
              size={16}
              style={{
                transition: 'transform 0.2s ease-in-out',
                transform: opened ? 'rotate(180deg)' : 'rotate(0deg)',
              }}
            />
          </Flex>
        </Text>
      </UnstyledButton>
      <Collapse in={opened}>
        <Text size="md" c="white" fw="bold">
          Coming Soon 👀
        </Text>
      </Collapse>
    </>
  );
}
