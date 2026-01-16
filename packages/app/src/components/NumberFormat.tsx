import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
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
import {
  IconClock,
  IconCurrencyDollar,
  IconDatabase,
  IconNumbers,
  IconPercentage,
  IconX,
} from '@tabler/icons-react';

import { NumberFormat } from '../types';
import { formatNumber } from '../utils';

const FORMAT_NAMES: Record<string, string> = {
  number: 'Number',
  currency: 'Currency',
  percent: 'Percentage',
  byte: 'Bytes',
  time: 'Time',
};

const FORMAT_ICONS: Record<string, React.ReactNode> = {
  number: <IconNumbers size={14} />,
  currency: <IconCurrencyDollar size={14} />,
  percent: <IconPercentage size={14} />,
  byte: <IconDatabase size={14} />,
  time: <IconClock size={14} />,
};

const DEFAULT_NUMBER_FORMAT: NumberFormat = {
  factor: 1,
  output: 'number',
  mantissa: 2,
  thousandSeparated: true,
  average: false,
  decimalBytes: false,
};

const TEST_NUMBER = 1234;

export const NumberFormatForm: React.FC<{
  value?: NumberFormat;
  onApply: (value: NumberFormat) => void;
  onClose: () => void;
}> = ({ value, onApply, onClose }) => {
  const { register, handleSubmit, control, setValue } = useForm<NumberFormat>({
    defaultValues: value ?? DEFAULT_NUMBER_FORMAT,
  });

  const format = useWatch({ control });

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
            leftSection={format.output && FORMAT_ICONS[format.output]}
            style={{ flex: 1 }}
            data={[
              { value: 'number', label: 'Number' },
              { value: 'currency', label: 'Currency' },
              { value: 'byte', label: 'Bytes' },
              { value: 'percent', label: 'Percentage' },
              { value: 'time', label: 'Time' },
            ]}
            {...register('output')}
          />
          {format.output === 'currency' && (
            <TextInput
              w={80}
              label="Symbol"
              placeholder="$"
              {...register('currencySymbol')}
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
            {formatNumber(TEST_NUMBER, format as NumberFormat)}
          </Paper>
        </div>

        {format.output !== 'time' && (
          <div>
            <div className="fs-8 mt-2 fw-bold mb-1">Decimals</div>
            <Slider
              mb="xl"
              min={0}
              max={10}
              label={value => `Decimals: ${value}`}
              marks={[
                { value: 0, label: '0' },
                { value: 10, label: '10' },
              ]}
              value={format.mantissa}
              onChange={value => {
                setValue('mantissa', value);
              }}
            />
          </div>
        )}
        <Stack gap="xs">
          {format.output === 'byte' ? (
            <MCheckbox
              size="xs"
              label="Decimal base"
              description="Use 1KB = 1000 bytes"
              {...register('decimalBytes')}
            />
          ) : format.output === 'time' ? (
            <NativeSelect
              size="sm"
              label="Input unit"
              {...register('factor', {
                setValueAs: value => parseFloat(value),
              })}
              data={[
                { value: '1', label: 'Seconds' },
                { value: '0.001', label: 'Milliseconds' },
              ]}
            />
          ) : (
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

export const NumberFormatInput: React.FC<{
  value?: NumberFormat;
  onChange: (value?: NumberFormat) => void;
}> = ({ value, onChange }) => {
  const [opened, { open, close }] = useDisclosure(false);

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
          leftSection={value?.output && FORMAT_ICONS[value.output]}
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
            <IconX size={14} />
          </Button>
        )}
      </Button.Group>
    </>
  );
};
