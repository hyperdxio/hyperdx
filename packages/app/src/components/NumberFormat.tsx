import * as React from 'react';
import { useForm } from 'react-hook-form';
import {
  Button,
  Checkbox as MCheckbox,
  Drawer,
  NativeSelect,
  Paper,
  Slider,
  Stack,
  TextInput,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { NumberFormat } from '../types';
import { formatNumber } from '../utils';

const FORMAT_NAMES: Record<string, string> = {
  number: 'Number',
  currency: 'Currency',
  percent: 'Percentage',
  byte: 'Bytes',
  time: 'Time',
};

const FORMAT_ICONS: Record<string, string> = {
  number: '123',
  currency: 'currency-dollar',
  percent: 'percent',
  byte: 'database',
  time: 'clock',
};

export const NumberFormatForm: React.VFC<{
  value?: NumberFormat;
  onApply: (value: NumberFormat) => void;
  onClose: () => void;
}> = ({ value, onApply, onClose }) => {
  const { register, handleSubmit, watch, setValue } = useForm<NumberFormat>({
    values: value,
    defaultValues: {
      factor: 1,
      output: 'number',
      mantissa: 2,
      thousandSeparated: true,
      average: false,
      decimalBytes: false,
    },
  });

  const values = watch();

  const testNumber = 1234;

  return (
    <>
      <Stack style={{ flex: 1 }}>
        {/* <TextInput
          label="Coefficient"
          type="number"
          description="Multiply number by this value before formatting. You can use it to convert source value to seconds, bytes, base currency, etc."
          {...register('factor', { valueAsNumber: true })}
          rightSectionWidth={70}
          rightSection={
            <Button
              variant="default"
              compact
              size="sm"
              onClick={() => setValue('factor', 1)}
            >
              Reset
            </Button>
          }
        /> */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'nowrap',
            alignItems: 'stretch',
            justifyContent: 'stretch',
            gap: 10,
          }}
        >
          <NativeSelect
            label="Output format"
            leftSection={
              values.output && (
                <i className={`bi bi-${FORMAT_ICONS[values.output]}`} />
              )
            }
            style={{ flex: 1 }}
            data={[
              { value: 'number', label: 'Number' },
              { value: 'currency', label: 'Currency' },
              { value: 'byte', label: 'Bytes' },
              { value: 'percent', label: 'Percentage' },
              { value: 'time', label: 'Time (seconds)' },
            ]}
            {...register('output')}
          />
          {values.output === 'currency' && (
            <TextInput
              w={80}
              label="Symbol"
              placeholder="$"
              {...register('currencySymbol')}
            />
          )}
          {/* <TextInput
            w={100}
            label="Unit"
            placeholder=""
            {...register('unit')}
          /> */}
        </div>

        <div style={{ marginTop: -6 }}>
          <Paper p="xs" py={4} bg="dark.8">
            <div
              className="text-slate-400"
              style={{
                fontSize: 11,
              }}
            >
              Example
            </div>
            {formatNumber(testNumber || 0, values)}
          </Paper>
        </div>

        {values.output !== 'time' && (
          <div>
            <div className="text-slate-300 fs-8 mt-2 fw-bold mb-1">
              Decimals
            </div>
            <Slider
              mb="xl"
              min={0}
              max={10}
              label={value => `Decimals: ${value}`}
              marks={[
                { value: 0, label: '0' },
                { value: 10, label: '10' },
              ]}
              value={values.mantissa}
              onChange={value => {
                setValue('mantissa', value);
              }}
            />
          </div>
        )}
        <Stack gap="xs">
          {values.output === 'byte' ? (
            <MCheckbox
              size="xs"
              label="Decimal base"
              description="Use 1KB = 1000 bytes"
              {...register('decimalBytes')}
            />
          ) : values.output === 'time' ? null : (
            <>
              <MCheckbox
                size="xs"
                label="Separate thousands"
                description="For example: 1,234,567"
                {...register('thousandSeparated')}
              />
              <MCheckbox
                size="xs"
                label="Large number format"
                description="For example: 1.2m"
                {...register('average')}
              />
            </>
          )}
        </Stack>
        <Stack gap="xs" mt="xs">
          <Button type="submit" onClick={handleSubmit(onApply)}>
            Apply
          </Button>
          <Button onClick={onClose} variant="default">
            Cancel
          </Button>
        </Stack>
      </Stack>
    </>
  );
};

const TEST_NUMBER = 1234;

export const NumberFormatInput: React.VFC<{
  value?: NumberFormat;
  onChange: (value?: NumberFormat) => void;
}> = ({ value, onChange }) => {
  const [opened, { open, close }] = useDisclosure(false);
  const example = React.useMemo(
    () => formatNumber(TEST_NUMBER, value),
    [value],
  );

  const handleApply = React.useCallback(
    (value?: NumberFormat) => {
      onChange(value);
      close();
    },
    [onChange, close],
  );

  return (
    <>
      <Drawer
        opened={opened}
        onClose={close}
        title="Number format"
        position="right"
        padding="lg"
        zIndex={100000}
      >
        <NumberFormatForm value={value} onApply={handleApply} onClose={close} />
      </Drawer>
      <Button.Group>
        <Button
          onClick={open}
          size="compact-sm"
          color="dark"
          variant="default"
          leftSection={
            value?.output && (
              <i className={`bi bi-${FORMAT_ICONS[value.output]}`} />
            )
          }
        >
          {value?.output ? FORMAT_NAMES[value.output] : 'Set number format'}
        </Button>
        {value?.output && (
          <Button
            size="compact-sm"
            color="dark"
            variant="default"
            px="xs"
            onClick={() => handleApply(undefined)}
          >
            <i className="bi bi-x-lg" />
          </Button>
        )}
      </Button.Group>
    </>
  );
};
