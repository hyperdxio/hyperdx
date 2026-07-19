import { Control, UseFormSetValue } from 'react-hook-form';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

// traceModel= ...
// logModel=....
// traceModel.logModel = 'custom'
// will pop open the custom trace model form as well
// need to make sure we don't recursively render them :joy:
// OR traceModel.logModel = 'log_id_blah'
// custom always points towards the url param
import { LogTableModelForm } from './LogTableModelForm';
import { MetricTableModelForm } from './MetricTableModelForm';
import { PromqlTableModelForm } from './PromqlTableModelForm';
import { SessionTableModelForm } from './SessionTableModelForm';
import { TraceTableModelForm } from './TraceTableModelForm';

export function TableModelForm({
  control,
  setValue,
  kind,
}: {
  control: Control<TSource>;
  setValue: UseFormSetValue<TSource>;
  kind: SourceKind;
}) {
  switch (kind) {
    case SourceKind.Log:
      return <LogTableModelForm control={control} setValue={setValue} />;
    case SourceKind.Trace:
      return <TraceTableModelForm control={control} setValue={setValue} />;
    case SourceKind.Session:
      return <SessionTableModelForm control={control} setValue={setValue} />;
    case SourceKind.Metric:
      return <MetricTableModelForm control={control} setValue={setValue} />;
    case SourceKind.Promql:
      return <PromqlTableModelForm control={control} setValue={setValue} />;
  }
}
