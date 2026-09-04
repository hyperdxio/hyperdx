import {
  ActionIcon,
  Anchor,
  Card,
  Collapse,
  Divider,
  Group,
  Stack,
  Text,
} from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';

import { useLocalStorage } from '@/utils';

import { StepRow } from './StepRow';
import { useOnboardingCompletion } from './useOnboardingCompletion';

const OnboardingChecklist = ({
  onAddDataClick,
}: {
  onAddDataClick?: () => void;
}) => {
  const [isCollapsed, setIsCollapsed] = useLocalStorage(
    'onboardingChecklistCollapsed',
    false,
  );

  const {
    steps,
    phaseLabel,
    completedCount,
    activeStepId,
    isCelebrating,
    shouldShow,
    dismiss,
    isDismissing,
  } = useOnboardingCompletion(onAddDataClick);

  if (!shouldShow) {
    return null;
  }

  return (
    <Card p="md" mb="sm" radius="md" bg="var(--color-bg-muted)">
      <Group
        justify="space-between"
        align="flex-start"
        wrap="nowrap"
        mb={isCollapsed ? 0 : 'sm'}
      >
        <Text size="sm" fw={600} lh={1.25}>
          {phaseLabel}
        </Text>
        <Group gap={2} align="center" wrap="nowrap" flex="0 0 auto">
          <Text size="xxs" c="dimmed">
            {completedCount}/{steps.length}
          </Text>
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label={isCollapsed ? 'Expand checklist' : 'Collapse checklist'}
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {isCollapsed ? (
              <IconChevronDown size={16} stroke={2} />
            ) : (
              <IconChevronUp size={16} stroke={2} />
            )}
          </ActionIcon>
        </Group>
      </Group>

      <Collapse expanded={!isCollapsed}>
        <Stack gap={6}>
          {steps.map(step => (
            <StepRow
              key={step.id}
              step={step}
              isActive={step.id === activeStepId}
            />
          ))}

          {isCelebrating && (
            <Text size="sm" c="green" fw="bold" ta="center" mt="xs" p="xs">
              🎉 You&apos;re all set!
            </Text>
          )}
        </Stack>

        <Divider my="sm" />

        <Anchor
          component="button"
          type="button"
          c="dimmed"
          size="sm"
          underline="never"
          aria-label="Dismiss checklist"
          onClick={() => dismiss()}
          disabled={isDismissing}
        >
          Dismiss and don&apos;t show again
        </Anchor>
      </Collapse>
    </Card>
  );
};

export default OnboardingChecklist;
