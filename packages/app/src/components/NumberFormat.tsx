import * as React from 'react';
import { useMemo } from 'react';
import { Control, Controller, useWatch } from 'react-hook-form';
import { NumberFormat } from '@hyperdx/common-utils/dist/types';
import {
  Checkbox as MCheckbox,
  NativeSelect,
  Paper,
  Slider,
  Stack,
  TextInput,
} from '@mantine/core';
import {
  IconClock,
  IconCurrencyDollar,
  IconDatabase,
  IconNumbers,
  IconPercentage,
} from '@tabler/icons-react';

import { formatNumber } from '../utils';

import { ChartConfigDisplaySettings } from './ChartDisplaySettingsDrawer';

const FORMAT_ICONS: Record<string, React.ReactNode> = {
  number: <IconNumbers size={14} />,
  currency: <IconCurrencyDollar size={14} />,
  percent: <IconPercentage size={14} />,
  byte: <IconDatabase size={14} />,
  time: <IconClock size={14} />,
};

const TEST_NUMBER = 1234;

export const DEFAULT_NUMBER_FORMAT: NumberFormat = {
  factor: 1,
  output: 'number' as const,
  mantissa: 2,
  thousandSeparated: true,
  average: false,
  decimalBytes: false,
};

export const NumberFormatForm: React.FC<{
  control: Control<ChartConfigDisplaySettings>;
}> = ({ control }) => {
  const format =
    useWatch({ control, name: 'numberFormat' }) ?? DEFAULT_NUMBER_FORMAT;

  return (
    <>
      <Stack style={{ flex: 1 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'nowrap',
            alignItems: 'stretch',
            justifyContent: 'stretch',
            gap: 10,
          }}
        >
          <Controller
            control={control}
            key="numberFormat.output"
            name="numberFormat.output"
            render={({ field }) => (
              <NativeSelect
                {...field}
                label="Output format"
                leftSection={format.output && FORMAT_ICONS[format.output]}
                style={{ flex: 1 }}
                data={[
                  { value: 'number', label: 'Number' },
                  { value: 'currency', label: 'Currency' },
                  { value: 'byte', label: 'Bytes' },
                  { value: 'percent', label: 'Percentage' },
                  { value: 'time', label: 'Time' },
                ]}
              />
            )}
          />
          {format.output === 'currency' && (
            <Controller
              control={control}
              key="numberFormat.currencySymbol"
              name="numberFormat.currencySymbol"
              render={({ field }) => (
                <TextInput {...field} w={80} label="Symbol" placeholder="$" />
              )}
            />
          )}
        </div>

        <div style={{ marginTop: -6 }}>
          <Paper p="xs" py={4}>
            <div
              style={{
                fontSize: 11,
              }}
            >
              Example
            </div>
            {formatNumber(TEST_NUMBER || 0, format)}
          </Paper>
        </div>

        {format.output !== 'time' && (
          <div>
            <div className="fs-8 mt-2 fw-bold mb-1">Decimals</div>
            <Controller
              control={control}
              key="numberFormat.mantissa"
              name="numberFormat.mantissa"
              render={({ field: { value, onChange } }) => (
                <Slider
                  mb="xl"
                  min={0}
                  max={10}
                  label={val => `Decimals: ${val}`}
                  marks={[
                    { value: 0, label: '0' },
                    { value: 10, label: '10' },
                  ]}
                  value={value ?? 2}
                  onChange={onChange}
                />
              )}
            />
          </div>
        )}
        <Stack gap="xs">
          {format.output === 'byte' ? (
            <Controller
              control={control}
              key="numberFormat.decimalBytes"
              name="numberFormat.decimalBytes"
              render={({ field: { value, onChange, ...field } }) => {
                return (
                  <MCheckbox
                    {...field}
                    size="xs"
                    label="Decimal base"
                    description="Use 1KB = 1000 bytes"
                    checked={value}
                    onChange={onChange}
                  />
                );
              }}
            />
          ) : format.output === 'time' ? (
            <Controller
              control={control}
              key="numberFormat.factor"
              name="numberFormat.factor"
              render={({ field: { value, onChange, ...field } }) => {
                const options = [
                  { value: '1', label: 'Seconds' },
                  { value: '0.001', label: 'Milliseconds' },
                  { value: '0.000001', label: 'Microseconds' },
                  { value: '0.000000001', label: 'Nanoseconds' },
                ];

                const stringValue =
                  options.find(option => parseFloat(option.value) === value)
                    ?.value ?? '1';

                return (
                  <NativeSelect
                    {...field}
                    size="sm"
                    label="Input unit"
                    value={stringValue}
                    onChange={e => onChange(parseFloat(e.target.value))}
                    data={options}
                  />
                );
              }}
            />
          ) : (
            <>
              <Controller
                control={control}
                key="numberFormat.thousandSeparated"
                name="numberFormat.thousandSeparated"
                render={({ field: { value, onChange, ...field } }) => (
                  <MCheckbox
                    {...field}
                    size="xs"
                    label="Separate thousands"
                    description="For example: 1,234,567"
                    checked={value}
                    onChange={onChange}
                  />
                )}
              />
              <Controller
                control={control}
                key="numberFormat.average"
                name="numberFormat.average"
                render={({ field: { value, onChange, ...field } }) => (
                  <MCheckbox
                    {...field}
                    size="xs"
                    label="Large number format"
                    description="For example: 1.2m"
                    checked={value}
                    onChange={onChange}
                  />
                )}
              />
            </>
          )}
        </Stack>
      </Stack>
    </>
  );
};
