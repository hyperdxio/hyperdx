import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Flex, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCheck,
  IconCopy,
  IconFilter,
  IconFilterX,
} from '@tabler/icons-react';

import {
  CLIPBOARD_ERROR_MESSAGE,
  copyTextToClipboard,
} from '@/utils/clipboard';

import { FilterAutocomplete } from './FilterAutocomplete';

export type FilterValueEditorProps = {
  value: string;
  /** Suggestions to switch to; the current value is always listed. */
  valueOptions: string[];
  isLoadingValues?: boolean;
  isExcluded: boolean;
  /** Called only when the new value differs from `value`. */
  onReplaceValue: (value: string) => void;
  onTogglePolarity: () => void;
  /** Called after a commit or polarity toggle, e.g. to close the popover. */
  onDone: () => void;
};

/** Change a filter's value, copy it, or flip it between include and exclude. */
export function FilterValueEditor({
  value,
  valueOptions,
  isLoadingValues,
  isExcluded,
  onReplaceValue,
  onTogglePolarity,
  onDone,
}: FilterValueEditorProps) {
  // Starts empty, with the current value as the placeholder, so the full
  // suggestion list shows instead of being filtered down to the current value.
  const [draftValue, setDraftValue] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  const options = useMemo(
    () => Array.from(new Set([value, ...valueOptions])),
    [value, valueOptions],
  );

  // Skip a no-op replace so Enter without a change doesn't rerun the query.
  const commitValue = (next: string) => {
    const trimmed = next.trim();
    if (trimmed && trimmed !== value) {
      onReplaceValue(trimmed);
    }
    onDone();
  };

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(value);
    if (!ok) {
      notifications.show({ color: 'red', message: CLIPBOARD_ERROR_MESSAGE });
      return;
    }
    setCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  const polarityLabel = isExcluded ? 'Include' : 'Exclude';

  return (
    <>
      <FilterAutocomplete
        w={220}
        mb={6}
        options={options}
        value={draftValue}
        onChange={setDraftValue}
        onSubmit={commitValue}
        onOptionSubmit={commitValue}
        placeholder={isLoadingValues ? 'Loading values...' : value}
        aria-label="Change filter value"
      />
      <Flex gap={4} align="center">
        <Tooltip label={copied ? 'Copied' : 'Copy value'}>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            onClick={handleCopy}
            aria-label="Copy value"
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label={polarityLabel}>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            onClick={() => {
              onTogglePolarity();
              onDone();
            }}
            aria-label={polarityLabel}
          >
            {isExcluded ? <IconFilter size={14} /> : <IconFilterX size={14} />}
          </ActionIcon>
        </Tooltip>
      </Flex>
    </>
  );
}
