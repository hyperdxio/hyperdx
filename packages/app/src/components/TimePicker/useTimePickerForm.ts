import { useForm } from '@mantine/form';

import { TimePickerMode } from './types';

type TimePickerForm = {
  startDate: Date | null;
  endDate: Date | null;
  duration: string;
};

export const useTimePickerForm = ({ mode }: { mode: TimePickerMode }) => {
  const form = useForm<TimePickerForm>({
    mode: 'controlled',
    initialValues: {
      startDate: null,
      endDate: null,
      duration: '15m',
    },

    validate: values => {
      if (mode === TimePickerMode.Range) {
        if (!values.startDate || !values.endDate) {
          return { startDate: 'Required', endDate: 'Required' };
        }
      }
      if (mode === TimePickerMode.Around) {
        if (!values.startDate) {
          return { time: 'Required' };
        }
        if (!values.duration) {
          return { duration: 'Required' };
        }
      }
      return {};
    },

    onValuesChange: values => {
      // Ensure that end date is not before start date
      // Guard with getTime() since Mantine v9 DateInput may supply strings
      const start =
        values.startDate instanceof Date
          ? values.startDate
          : values.startDate
            ? new Date(values.startDate)
            : null;
      const end =
        values.endDate instanceof Date
          ? values.endDate
          : values.endDate
            ? new Date(values.endDate)
            : null;
      if (start && end && end.getTime() < start.getTime()) {
        form.setFieldValue('endDate', values.startDate);
      }
    },
  });

  return form;
};
