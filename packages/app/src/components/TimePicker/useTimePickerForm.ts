import { useForm } from '@mantine/form';

type TimePickerForm = {
  startDate: Date | null;
  endDate: Date | null;
  duration: string;
};

export const useTimePickerForm = ({ mode }: { mode: string }) => {
  const form = useForm<TimePickerForm>({
    mode: 'controlled',
    initialValues: {
      startDate: null,
      endDate: null,
      duration: '15m',
    },

    validate: values => {
      if (mode === 'Time range') {
        if (!values.startDate || !values.endDate) {
          return { startDate: 'Required', endDate: 'Required' };
        }
      }
      if (mode === 'Around a time') {
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
      if (
        values.endDate &&
        values.startDate &&
        values.endDate < values.startDate
      ) {
        form.setFieldValue('endDate', values.startDate);
      }
    },
  });

  return form;
};
