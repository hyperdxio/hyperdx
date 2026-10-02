import { useState } from 'react';
import cx from 'classnames';
import type { HTMLAttributes, ReactNode } from 'react';
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
  /** `md` for page titles, `sm` for editor headers, `xs` for compact rows. */
  size?: 'xs' | 'sm' | 'md';
  /** Required: the field has no visible label. */
  'aria-label': string;
  /** Wraps the field in a heading when it is the page title. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

function NameRoot({
  level,
  children,
  ...props
}: {
  level?: InlineNameFieldProps['headingLevel'];
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  if (level === 1) return <h1 {...props}>{children}</h1>;
  if (level === 2) return <h2 {...props}>{children}</h2>;
  if (level === 3) return <h3 {...props}>{children}</h3>;
  if (level === 4) return <h4 {...props}>{children}</h4>;
  if (level === 5) return <h5 {...props}>{children}</h5>;
  if (level === 6) return <h6 {...props}>{children}</h6>;
  return <span {...props}>{children}</span>;
}

function InlineNameField({
  value,
  onChange,
  size = 'sm',
  headingLevel,
  invalid,
  placeholder,
  ...inputProps
}: InlineNameFieldProps) {
  // The input's value is not part of its parent's accessible name, so the
  // heading would otherwise be announced as the input's label.
  const headingName = headingLevel != null ? value || placeholder : undefined;
  return (
    <NameRoot
      level={headingLevel}
      className={cx(classes.root, classes[size])}
      data-value={value || placeholder}
      aria-label={headingName}
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
    </NameRoot>
  );
}

export interface InlineNameInputProps
  extends Omit<InlineNameFieldProps, 'value' | 'onChange' | 'invalid'> {
  value: string;
  /**
   * Called with the trimmed name when it changed and isn't empty. Return a
   * promise so a failed save reverts the field; the typed name stays on
   * screen until `value` updates or the promise rejects.
   */
  onCommit: (name: string) => void | Promise<unknown>;
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
  // The name just committed, kept until the saved `value` catches up so the
  // title doesn't flash the old name while the save is in flight. Cleared
  // when `value` changes (the save landed, or something else wrote) or when
  // the commit rejects.
  const [pending, setPending] = useState<string>();
  const [trackedValue, setTrackedValue] = useState(value);
  if (value !== trackedValue) {
    setTrackedValue(value);
    setPending(undefined);
  }

  // What the user is typing. Undefined means show the committed name.
  const [draft, setDraft] = useState<string>();
  const shown = draft ?? pending ?? value;

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // The blur handler reads the DOM value, so reset it before blurring.
      e.currentTarget.value = pending ?? value;
      e.currentTarget.blur();
    }
  };

  return (
    <InlineNameField
      {...fieldProps}
      value={shown}
      onChange={setDraft}
      onKeyDown={handleKeyDown}
      onBlur={e => {
        const next = e.currentTarget.value.trim();
        setDraft(undefined);
        if (next !== '' && next !== (pending ?? value)) {
          setPending(next);
          Promise.resolve(onCommit(next)).catch(() => {
            setPending(current => (current === next ? undefined : current));
          });
        } else if (next === '') {
          setPending(undefined);
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
