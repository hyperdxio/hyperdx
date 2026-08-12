import * as React from 'react';
import { Badge, Card, Group, Modal, Stack, Switch, Text } from '@mantine/core';
import { IconFlask } from '@tabler/icons-react';

import type { Lab } from '@/labs/registry';
import { LABS } from '@/labs/registry';
import { useLabs } from '@/labs/useLabs';

const LabCard = ({
  lab,
  enabled,
  disabled,
  onChange,
}: {
  lab: Lab;
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) => {
  return (
    <Card data-testid={`lab-card-${lab.id}`}>
      <Group align="flex-start" justify="space-between" wrap="nowrap" gap="md">
        <div style={{ flex: 1 }}>
          <Group align="center" gap="xs">
            <Text size="sm" fw="bold">
              {lab.title}
            </Text>
            {!!lab.badge && (
              <Badge variant="light" fw="normal" size="xs">
                {lab.badge}
              </Badge>
            )}
          </Group>
          <Text size="xs" mt={4}>
            {lab.description}
          </Text>
        </div>
        {/*
          Two testids on purpose. Mantine puts arbitrary props on the <input>,
          which it hides behind an aria-hidden track — so that one is assertable
          (toBeChecked) but not clickable. wrapperProps lands on the enclosing
          <label>, which is what a user actually clicks.
        */}
        <Switch
          size="md"
          data-testid={`lab-switch-${lab.id}`}
          wrapperProps={{ 'data-testid': `lab-toggle-${lab.id}` }}
          aria-label={lab.title}
          checked={enabled}
          disabled={disabled}
          onChange={e => onChange(e.currentTarget.checked)}
        />
      </Group>
    </Card>
  );
};

export const LabsModal = ({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) => {
  const { enabled, isLoading, setLabEnabled } = useLabs();

  return (
    <Modal
      data-testid="labs-modal"
      title={
        <Group align="center" gap="xs">
          <IconFlask size={18} />
          <div>
            <span>HyperDX Labs</span>
            <Text size="xs" mt={6}>
              Try features that are still being built
            </Text>
          </div>
        </Group>
      }
      size="lg"
      padding="lg"
      keepMounted={false}
      opened={opened}
      onClose={onClose}
    >
      {/*
        Inner content carries its own testid: a Mantine Modal's root stays in the
        DOM with zero dimensions, so it never reads as "visible" to Playwright.
        Open-state assertions have to target content, closed-state the root.
      */}
      <Stack gap="md" data-testid="labs-modal-content">
        {LABS.length === 0 ? (
          <Text size="sm" data-testid="labs-empty-state">
            No experiments are available right now. Check back soon.
          </Text>
        ) : (
          <>
            <Text size="xs">
              These are unfinished, so expect rough edges. Everything here is
              off by default and you can turn it off again at any time. Your
              choices are saved to your account, so they follow you across
              browsers and devices.
            </Text>
            {LABS.map(lab => (
              <LabCard
                key={lab.id}
                lab={lab}
                enabled={enabled[lab.id] === true}
                disabled={isLoading}
                onChange={value => setLabEnabled(lab.id, value)}
              />
            ))}
          </>
        )}
      </Stack>
    </Modal>
  );
};
