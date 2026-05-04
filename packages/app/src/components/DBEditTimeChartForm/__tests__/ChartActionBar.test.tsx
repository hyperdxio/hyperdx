import React from 'react';
import { useForm } from 'react-hook-form';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ChartEditorFormState } from '@/components/ChartEditor/types';

import { ChartActionBar } from '../ChartActionBar';

jest.mock('@/components/SQLEditor/SQLInlineEditor', () => ({
  SQLInlineEditorControlled: (props: any) => (
    <div data-testid="sql-editor-order-by">{props.label}</div>
  ),
}));

jest.mock('@/components/TimePicker', () => ({
  TimePicker: () => <div data-testid="time-picker">TimePicker</div>,
}));

jest.mock('@/GranularityPicker', () => ({
  GranularityPickerControlled: () => (
    <div data-testid="granularity-picker">Granularity</div>
  ),
}));

const defaultTableConnection = {
  databaseName: 'default',
  tableName: 'logs',
  connectionId: 'default',
};

type WrapperProps = {
  children: (props: { control: any; handleSubmit: any }) => React.ReactNode;
  defaultValues?: Partial<ChartEditorFormState>;
};

function FormWrapper({ children, defaultValues }: WrapperProps) {
  const { control, handleSubmit } = useForm<ChartEditorFormState>({
    defaultValues: {
      displayType: DisplayType.Line,
      name: 'Test Chart',
      select: [
        {
          aggFn: 'count',
          aggCondition: '',
          aggConditionLanguage: 'lucene',
          valueExpression: '',
        },
      ],
      where: '',
      whereLanguage: 'lucene',
      granularity: 'auto',
      ...defaultValues,
    },
  });

  return <>{children({ control, handleSubmit })}</>;
}

const renderActionBar = (
  overrides: Partial<React.ComponentProps<typeof ChartActionBar>> = {},
) => {
  const onSubmit = jest.fn();
  const handleSave = jest.fn();
  const onSave = jest.fn();
  const onClose = jest.fn();
  const setSaveToDashboardModalOpen = jest.fn();

  const result = renderWithMantine(
    <FormWrapper>
      {({ control, handleSubmit }) => (
        <ChartActionBar
          control={control}
          handleSubmit={handleSubmit}
          tableConnection={defaultTableConnection}
          activeTab="time"
          isRawSqlInput={false}
          parentRef={null}
          groupBy=""
          onSubmit={onSubmit}
          handleSave={handleSave}
          onSave={onSave}
          onClose={onClose}
          setSaveToDashboardModalOpen={setSaveToDashboardModalOpen}
          {...overrides}
        />
      )}
    </FormWrapper>,
  );

  return {
    ...result,
    onSubmit,
    handleSave,
    onSave,
    onClose,
    setSaveToDashboardModalOpen,
  };
};

describe('ChartActionBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render Save button when onSave is provided', () => {
    renderActionBar();

    expect(screen.getByTestId('chart-save-button')).toBeInTheDocument();
    expect(screen.getByTestId('chart-save-button')).toHaveTextContent('Save');
  });

  it('should not render Save button when onSave is undefined', () => {
    renderActionBar({ onSave: undefined });

    expect(screen.queryByTestId('chart-save-button')).not.toBeInTheDocument();
  });

  it('should render Cancel button when onClose is provided', () => {
    renderActionBar();

    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('should not render Cancel button when onClose is undefined', () => {
    renderActionBar({ onClose: undefined });

    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });

  it('should call onClose when Cancel is clicked', async () => {
    const { onClose } = renderActionBar();

    await userEvent.click(screen.getByText('Cancel'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should render Run button for non-markdown tabs', () => {
    renderActionBar({ activeTab: 'time' });

    expect(screen.getByTestId('chart-run-query-button')).toBeInTheDocument();
    expect(screen.getByTestId('chart-run-query-button')).toHaveTextContent(
      'Run',
    );
  });

  it('should not render Run button for markdown tab', () => {
    renderActionBar({ activeTab: 'markdown' });

    expect(
      screen.queryByTestId('chart-run-query-button'),
    ).not.toBeInTheDocument();
  });

  it('should call onSubmit when Run is clicked', async () => {
    const { onSubmit } = renderActionBar();

    await userEvent.click(screen.getByTestId('chart-run-query-button'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('should render granularity picker for time tab', () => {
    renderActionBar({ activeTab: 'time' });

    expect(screen.getByTestId('granularity-picker')).toBeInTheDocument();
  });

  it('should not render granularity picker for non-time tabs', () => {
    renderActionBar({ activeTab: 'table' });

    expect(screen.queryByTestId('granularity-picker')).not.toBeInTheDocument();
  });

  it('should render ORDER BY editor for table tab when not raw SQL', () => {
    renderActionBar({ activeTab: 'table', isRawSqlInput: false });

    expect(screen.getByTestId('sql-editor-order-by')).toBeInTheDocument();
  });

  it('should not render ORDER BY editor for table tab when raw SQL', () => {
    renderActionBar({ activeTab: 'table', isRawSqlInput: true });

    expect(screen.queryByTestId('sql-editor-order-by')).not.toBeInTheDocument();
  });

  it('should render TimePicker when time range props are provided', () => {
    renderActionBar({
      displayedTimeInputValue: 'Last 24h',
      setDisplayedTimeInputValue: jest.fn(),
      onTimeRangeSearch: jest.fn(),
    });

    expect(screen.getByTestId('time-picker')).toBeInTheDocument();
  });

  it('should not render TimePicker when time range props are missing', () => {
    renderActionBar({
      displayedTimeInputValue: undefined,
      setDisplayedTimeInputValue: undefined,
      onTimeRangeSearch: undefined,
    });

    expect(screen.queryByTestId('time-picker')).not.toBeInTheDocument();
  });

  it('should disable Cancel button when isSaving is true', () => {
    renderActionBar({ isSaving: true });

    expect(screen.getByText('Cancel').closest('button')).toBeDisabled();
  });

  it('should render action bar controls for raw SQL input mode', () => {
    renderActionBar({ isRawSqlInput: true, activeTab: 'time' });

    // The key regression test: action bar renders even for raw SQL
    expect(screen.getByTestId('chart-save-button')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByTestId('chart-run-query-button')).toBeInTheDocument();
    expect(screen.getByTestId('granularity-picker')).toBeInTheDocument();
  });
});
