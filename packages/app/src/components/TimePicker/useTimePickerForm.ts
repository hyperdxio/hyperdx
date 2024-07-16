import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { useForm } from '@mantine/form';

type Mode = 'Time range' | 'Around a time';

const modeAtom = atomWithStorage<Mode>('time-picker-mode', 'Time range');

type TimePickerForm = {
  mode: 'Time range' | 'Around a time';
  startDate: Date | null;
  endDate: Date | null;
  duration: string;
};

export const useTimePickerForm = () => {
  const [mode, setMode] = useAtom(modeAtom);

  const form = useForm<TimePickerForm>({
    mode: 'controlled',
    initialValues: {
      mode: mode,
      startDate: null,
      endDate: null,
      duration: '15m',
    },

    validate: values => {
      if (values.mode === 'Time range') {
        if (!values.startDate || !values.endDate) {
          return { startDate: 'Required', endDate: 'Required' };
        }
      }
      if (values.mode === 'Around a time') {
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
      setMode(values.mode);

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
