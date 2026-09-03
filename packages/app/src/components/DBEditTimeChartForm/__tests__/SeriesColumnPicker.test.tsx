import { useForm } from 'react-hook-form';
import { JSDataType } from '@hyperdx/common-utils/dist/clickhouse';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SeriesColumnPicker } from '@/components/DBEditTimeChartForm/SeriesColumnPicker';
import { useMultipleAllFields } from '@/hooks/useMetadata';

jest.mock('@/hooks/useMetadata', () => ({
  useMultipleAllFields: jest.fn(() => ({ data: [] })),
}));

const mockedUseMultipleAllFields = useMultipleAllFields as jest.Mock;

function Harness({
  aggFn,
  valueExpression = '',
  onSubmit,
}: {
  aggFn: string;
  valueExpression?: string;
  onSubmit?: () => void;
}) {
  const { control } = useForm({ defaultValues: { valueExpression } });
  return (
    <SeriesColumnPicker
      control={control}
      name="valueExpression"
      aggFn={aggFn}
      onSubmit={onSubmit}
    />
  );
}

describe('SeriesColumnPicker', () => {
  beforeEach(() => {
    mockedUseMultipleAllFields.mockReturnValue({
      data: [
        { path: ['Duration'], type: 'UInt64', jsType: JSDataType.Number },
        { path: ['ServiceName'], type: 'String', jsType: JSDataType.String },
        {
          path: ['LogAttributes', 'bytes'],
          type: 'Int64',
          jsType: JSDataType.Number,
        },
      ],
    });
  });

  it('asks for a field rather than showing an empty box', () => {
    renderWithMantine(<Harness aggFn="quantile" />);

    expect(
      screen.getByRole('button', { name: 'Select a field to aggregate' }),
    ).toBeInTheDocument();
    expect(screen.getByText('select field')).toBeVisible();
  });

  it('reads as the whole phrase, so the aggregation is not lost', () => {
    renderWithMantine(<Harness aggFn="avg" valueExpression="Duration" />);

    expect(
      screen.getByRole('button', { name: 'Aggregate of Duration' }),
    ).toBeInTheDocument();
  });

  it('offers only numeric fields for an average, which coerces to a number', async () => {
    const user = userEvent.setup();
    renderWithMantine(<Harness aggFn="avg" />);

    await user.click(screen.getByTestId('series-value-expression-target'));

    expect(
      await screen.findByRole('radio', { name: 'Duration' }),
    ).toBeInTheDocument();
    // A map key is as pickable as a column, so long as it holds a number.
    expect(screen.getByText("LogAttributes['bytes']")).toBeInTheDocument();
    expect(screen.queryByText('ServiceName')).not.toBeInTheDocument();
  });

  it('offers every field for count distinct, which passes the column through', async () => {
    const user = userEvent.setup();
    renderWithMantine(<Harness aggFn="count_distinct" />);

    await user.click(screen.getByTestId('series-value-expression-target'));

    expect(
      await screen.findByRole('radio', { name: 'ServiceName' }),
    ).toBeInTheDocument();
  });

  it('commits the pick and runs the query', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    renderWithMantine(<Harness aggFn="sum" onSubmit={onSubmit} />);

    await user.click(screen.getByTestId('series-value-expression-target'));
    await user.click(await screen.findByRole('radio', { name: 'Duration' }));

    expect(
      screen.getByRole('button', { name: 'Aggregate of Duration' }),
    ).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalled();
  });

  it('keeps a SQL expression the list could never have offered', async () => {
    const user = userEvent.setup();
    renderWithMantine(<Harness aggFn="avg" valueExpression="Duration / 1e6" />);

    await user.click(screen.getByTestId('series-value-expression-target'));

    expect(
      await screen.findByRole('radio', { name: 'Duration / 1e6' }),
    ).toBeChecked();
  });
});
