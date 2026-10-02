import { useState } from 'react';
import cx from 'classnames';
import type { InputHTMLAttributes, KeyboardEvent, Ref } from 'react';
import { Control, Controller, FieldValues, Path } from 'react-hook-form';

import classes from './InlineNameInput.module.scss';

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'value' | 'defaultValue' | 'onChange' | 'className' | 'style'
>;

interface InlineNameFieldProps extends NativeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** `lg` for page titles, `sm` for editor headers. */
  size?: 'lg' | 'sm';
  /** Required: the field has no visible label. */
  'aria-label': string;
  /** Wraps the field in a heading when it is the page title. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

function InlineNameField({
  value,
  onChange,
  size = 'lg',
  headingLevel,
  invalid,
  placeholder,
  ...inputProps
}: InlineNameFieldProps) {
  const Root = headingLevel != null ? (`h${headingLevel}` as const) : 'span';
  return (
    <Root
      className={cx(classes.root, classes[size])}
      data-value={value || placeholder}
    >
      <input
        {...inputProps}
        type="text"
        // Drops the native ~20 character width so the grid sizes to the text.
        size={1}
        className={classes.input}
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onChange={e => onChange(e.target.value)}
      />
    </Root>
  );
}

export interface InlineNameInputProps
  extends Omit<InlineNameFieldProps, 'value' | 'onChange' | 'invalid'> {
  value: string;
  /** Called with the trimmed name when it changed and isn't empty. */
  onCommit: (name: string) => void;
}

/**
 * Name of an object that is already saved. Enter or blur commits, Escape
 * reverts, and an empty name reverts.
 */
export function InlineNameInput({
  value,
  onCommit,
  onKeyDown,
  onBlur,
  ...fieldProps
}: InlineNameInputProps) {
  // Outside of editing, show the saved value rather than the last draft, so a
  // save that fails or gets overwritten doesn't leave a stale name on screen.
  const [draft, setDraft] = useState<string>();

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // The blur handler reads the DOM value, so reset it before blurring.
      e.currentTarget.value = value;
      e.currentTarget.blur();
    }
  };

  return (
    <InlineNameField
      {...fieldProps}
      value={draft ?? value}
      onChange={setDraft}
      onKeyDown={handleKeyDown}
      onBlur={e => {
        setDraft(undefined);
        const next = e.currentTarget.value.trim();
        if (next !== '' && next !== value) {
          onCommit(next);
        }
        onBlur?.(e);
      }}
    />
  );
}

export interface InlineNameInputControlledProps<T extends FieldValues>
  extends Omit<InlineNameFieldProps, 'value' | 'onChange' | 'invalid'> {
  name: Path<T>;
  control: Control<T>;
  rules?: Parameters<Control<T>['register']>[1];
}

/**
 * Name of a draft, such as a tile in the editor. The value is saved with the
 * rest of the form.
 */
export function InlineNameInputControlled<T extends FieldValues>({
  name,
  control,
  rules,
  ...fieldProps
}: InlineNameInputControlledProps<T>) {
  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState: { error } }) => (
        <InlineNameField
          {...fieldProps}
          ref={field.ref}
          name={field.name}
          value={field.value ?? ''}
          onChange={field.onChange}
          onBlur={field.onBlur}
          invalid={error != null}
        />
      )}
    />
  );
}
