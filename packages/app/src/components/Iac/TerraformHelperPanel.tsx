import { useState } from 'react';
import {
  Anchor,
  Badge,
  Collapse,
  Group,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core';

import { CopySnippet } from '@/components/ClickStackOnboarding/CopySnippet';

export type TerraformSnippet = {
  label: string;
  snippet: string;
  /** Render behind a toggle — for boilerplate most users only need once. */
  collapsible?: boolean;
  /** Shown above the snippet when collapsible, explaining when it's needed. */
  hint?: string;
};

// Snippets can run long. Capping the area keeps the popover from resizing
// (and re-anchoring) as content grows.
const SNIPPETS_MAX_HEIGHT = 360;

/**
 * A snippet tucked behind a toggle, following the `DeeplinkInstall` idiom.
 * Used for the provider block: Terraform allows only one `required_providers`
 * and one default provider config per module, so most users need it once and
 * pasting it again is an error rather than a convenience.
 */
function CollapsibleSnippet({ snippet }: { snippet: TerraformSnippet }) {
  const [opened, setOpened] = useState(false);
  return (
    <Stack gap="xs">
      <Anchor component="button" size="sm" onClick={() => setOpened(v => !v)}>
        {opened ? 'Hide' : 'Show'} {snippet.label.toLowerCase()}
      </Anchor>
      <Collapse expanded={opened} transitionDuration={150}>
        <Stack gap="xs">
          {snippet.hint && (
            <Text size="xs" style={{ color: 'var(--color-text-muted)' }}>
              {snippet.hint}
            </Text>
          )}
          <CopySnippet label={snippet.label} snippet={snippet.snippet} />
        </Stack>
      </Collapse>
    </Stack>
  );
}

/**
 * Presentational panel for Terraform snippets. Takes fully-built strings, so
 * it needs no data fetching and its stories need no mocking — callers own
 * generation via `terraformSnippets.ts`.
 */
export function TerraformHelperPanel({
  snippets,
}: {
  snippets: TerraformSnippet[];
}) {
  return (
    <Stack gap="sm" data-testid="terraform-helper-panel">
      <Group gap="xs">
        <Text size="sm" fw={500}>
          Terraform
        </Text>
        <Badge variant="light" fw="normal" size="xs">
          Experimental
        </Badge>
      </Group>
      <Text size="xs" style={{ color: 'var(--color-text-muted)' }}>
        ClickStack resources in the ClickHouse Terraform provider are in alpha —
        behaviour may change between provider versions. Generate resource
        configuration with{' '}
        <Text span ff="monospace" size="xs">
          terraform plan -generate-config-out
        </Text>{' '}
        rather than hand-writing it.
      </Text>
      <ScrollArea.Autosize
        mah={SNIPPETS_MAX_HEIGHT}
        type="auto"
        offsetScrollbars
      >
        <Stack gap="sm">
          {snippets.map(s =>
            s.collapsible ? (
              <CollapsibleSnippet key={s.label} snippet={s} />
            ) : (
              <CopySnippet key={s.label} label={s.label} snippet={s.snippet} />
            ),
          )}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}
