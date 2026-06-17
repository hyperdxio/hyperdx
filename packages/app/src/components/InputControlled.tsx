import React from 'react';
import { Control, Controller, FieldValues, Path } from 'react-hook-form';
import {
  Autocomplete,
  AutocompleteProps,
  Checkbox,
  CheckboxProps,
  Input,
  InputProps,
  PasswordInput,
  PasswordInputProps,
  TextInput,
  TextInputProps,
} from '@mantine/core';

interface InputControlledProps<T extends FieldValues>
  extends Omit<InputProps, 'name' | 'style'>,
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name' | 'size'> {
  name: Path<T>;
  control: Control<T>;
  rules?: Parameters<Control<T>['register']>[1];
}

interface PasswordInputControlledProps<T extends FieldValues>
  extends Omit<PasswordInputProps, 'name' | 'style'>,
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name' | 'size'> {
  name: Path<T>;
  control: Control<T>;
  rules?: Parameters<Control<T>['register']>[1];
}

interface TextInputControlledProps<T extends FieldValues>
  extends Omit<TextInputProps, 'name' | 'style'>,
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name' | 'size'> {
  name: Path<T>;
  control: Control<T>;
  rules?: Parameters<Control<T>['register']>[1];
}

interface CheckboxControlledProps<T extends FieldValues>
  extends Omit<CheckboxProps, 'name' | 'style'>,
    Omit<
      React.InputHTMLAttributes<HTMLInputElement>,
      'name' | 'size' | 'color'
    > {
  name: Path<T>;
  control: Control<T>;
  rules?: Parameters<Control<T>['register']>[1];
}

// Autocomplete already extends the native input attributes (minus its own
// value-based onChange and size), so it carries maxLength/placeholder without
// a second InputHTMLAttributes extend that would clash on onChange.
interface AutocompleteControlledProps<T extends FieldValues>
  extends Omit<AutocompleteProps, 'name' | 'style'> {
  name: Path<T>;
  control: Control<T>;
  rules?: Parameters<Control<T>['register']>[1];
}

export function TextInputControlled<T extends FieldValues>({
  name,
  control,
  rules,
  ...props
}: TextInputControlledProps<T>) {
  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState: { error } }) => (
        <TextInput {...props} {...field} error={error?.message} />
      )}
    />
  );
}

export function InputControlled<T extends FieldValues>({
  name,
  control,
  rules,
  ...props
}: InputControlledProps<T>) {
  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState: { error } }) => (
        <Input {...props} {...field} error={error?.message} />
      )}
    />
  );
}

export function PasswordInputControlled<T extends FieldValues>({
  name,
  control,
  rules,
  ...props
}: PasswordInputControlledProps<T>) {
  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState: { error } }) => (
        <PasswordInput {...props} {...field} error={error?.message} />
      )}
    />
  );
}

export function CheckBoxControlled<T extends FieldValues>({
  name,
  control,
  rules,
  ...props
}: CheckboxControlledProps<T>) {
  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field: { value, ...field }, fieldState: { error } }) => (
        <Checkbox
          {...props}
          {...field}
          checked={value}
          error={error?.message}
        />
      )}
    />
  );
}

export function AutocompleteControlled<T extends FieldValues>({
  name,
  control,
  rules,
  ...props
}: AutocompleteControlledProps<T>) {
  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      // Autocomplete is free-text: onChange passes the typed/selected string
      // straight through, and value is coerced from a possibly-undefined field
      // to '' so it stays controlled.
      render={({ field: { value, ...field }, fieldState: { error } }) => (
        <Autocomplete
          {...props}
          {...field}
          value={value ?? ''}
          error={error?.message}
        />
      )}
    />
  );
}
