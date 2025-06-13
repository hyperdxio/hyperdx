import React from 'react';
import { Control, Controller, FieldValues, Path } from 'react-hook-form';
import {
  Input,
  InputProps,
  PasswordInput,
  PasswordInputProps,
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
