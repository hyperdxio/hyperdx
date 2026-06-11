import {
  ChangeEventHandler,
  KeyboardEventHandler,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CheckIcon,
  CloseButton,
  Combobox,
  Group,
  Pill,
  PillsInput,
  ScrollArea,
  Text,
  useCombobox,
} from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';

type VirtualMultiSelectProps = {
  data: string[];
  disabled?: boolean;
  /** Show a "Loading…" empty state while values are being fetched. */
  loading?: boolean;
  placeholder?: string;
  values: string[];
  onChange: (values: string[]) => void;
  'data-testid'?: string;
};

export function VirtualMultiSelect({
  data,
  disabled,
  loading,
  placeholder,
  values,
  onChange,
  'data-testid': dataTestId,
}: VirtualMultiSelectProps) {
  const viewportRef = useRef<HTMLDivElement>(null);

  const [search, setSearch] = useState('');

  const options = useMemo(() => {
    const searchLowerCase = search.trim().toLowerCase();
    return data.filter(item => item.toLowerCase().includes(searchLowerCase));
  }, [data, search]);

  const virtualizer = useVirtualizer({
    count: options.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 36,
    overscan: 5,
  });

  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
    onDropdownOpen: () => {
      combobox.updateSelectedOptionIndex('active');
      virtualizer.measure();
    },
  });

  const handleSelectValue = (val: string) =>
    onChange(
      values.includes(val) ? values.filter(v => v !== val) : [...values, val],
    );

  const handleRemoveValue = (val: string) =>
    onChange(values.filter(v => v !== val));

  const handleRemoveAllValues = () => onChange([]);

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = event => {
    if (event.key === 'Backspace' && search.length === 0 && values.length > 0) {
      event.preventDefault();
      handleRemoveValue(values[values.length - 1]);
    }
  };

  const handleChange: ChangeEventHandler<HTMLInputElement> = event => {
    combobox.updateSelectedOptionIndex();
    setSearch(event.currentTarget.value);
  };

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={handleSelectValue}
      disabled={disabled}
    >
      <Combobox.DropdownTarget>
        <PillsInput
          onClick={() => combobox.openDropdown()}
          disabled={disabled}
          size="xs"
          data-testid={dataTestId}
          {...(values.length
            ? {
                rightSection: (
                  <CloseButton
                    disabled={disabled}
                    size="xs"
                    variant="transparent"
                    onClick={handleRemoveAllValues}
                  />
                ),
                rightSectionPointerEvents: disabled ? 'none' : 'auto',
              }
            : {
                rightSection: <Combobox.Chevron />,
                rightSectionPointerEvents: 'none',
              })}
        >
          <Pill.Group>
            {values.map(item => (
              <Pill
                key={item}
                withRemoveButton
                onRemove={() => handleRemoveValue(item)}
                // manually disabling instead of using `disabled` prop
                // `disabled` prop hides remove button which can cause layout to jump
                aria-disabled={disabled}
                styles={{ root: { pointerEvents: disabled ? 'none' : 'auto' } }}
              >
                {item}
              </Pill>
            ))}

            <Combobox.EventsTarget>
              <PillsInput.Field
                onFocus={() => combobox.openDropdown()}
                onBlur={() => combobox.closeDropdown()}
                value={search}
                placeholder={placeholder}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
              />
            </Combobox.EventsTarget>
          </Pill.Group>
        </PillsInput>
      </Combobox.DropdownTarget>

      <Combobox.Dropdown>
        <Combobox.Options>
          {options.length > 0 ? (
            <ScrollArea.Autosize
              type="scroll"
              mah={300}
              viewportRef={viewportRef}
            >
              <div
                style={{
                  height: `${totalSize}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualItems.map(virtualItem => {
                  const item = options[virtualItem.index];

                  return (
                    <div
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <Combobox.Option
                        value={item}
                        active={values.includes(item)}
                      >
                        <Group gap="xs">
                          {values.includes(item) && <CheckIcon size={10} />}
                          <Text size="xs">{item}</Text>
                        </Group>
                      </Combobox.Option>
                    </div>
                  );
                })}
              </div>
            </ScrollArea.Autosize>
          ) : (
            <Combobox.Empty>
              {loading ? 'Loading…' : 'Nothing found...'}
            </Combobox.Empty>
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
