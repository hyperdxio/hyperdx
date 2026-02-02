import { Control, useController } from 'react-hook-form';
import { NumberInput } from '@mantine/core';

export const ApdexThresholdInput = ({
  name,
  control,
}: {
  name: string;
  control: Control;
}) => {
  const { field } = useController({
    name,
    control,
  });
  return (
    <>
      <div>Threshold</div>
      <NumberInput placeholder="Your metric target" hideControls {...field} />
    </>
  );
};
