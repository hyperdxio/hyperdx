import React, { MouseEventHandler, useMemo } from 'react';
import {
  components,
  MultiValueGenericProps,
  MultiValueProps,
  OnChangeValue,
  Props,
} from 'react-select';
import AsyncSelect from 'react-select/async';
import {
  SortableContainer,
  SortableContainerProps,
  SortableElement,
  SortableHandle,
  SortEndHandler,
} from 'react-sortable-hoc';

import api from '@/api';
import { useColumns } from '@/hooks/useMetadata';

// import { usePropertyOptions } from './ChartUtils';

function arrayMove<T>(array: readonly T[], from: number, to: number) {
  const slicedArray = array.slice();
  slicedArray.splice(
    to < 0 ? array.length + to : to,
    0,
    slicedArray.splice(from, 1)[0],
  );
  return slicedArray;
}

const SortableMultiValue = SortableElement(
  (props: MultiValueProps<{ value: string; label: string }, true>) => {
    // this prevents the menu from being opened/closed when the user clicks
    // on a value to begin dragging it. ideally, detecting a click (instead of
    // a drag) would still focus the control and toggle the menu, but that
    // requires some magic with refs that are out of scope for this example
    const onMouseDown: MouseEventHandler<HTMLDivElement> = e => {
      e.preventDefault();
      e.stopPropagation();
    };
    const innerProps = { ...props.innerProps, onMouseDown };
    return <components.MultiValue {...props} innerProps={innerProps} />;
  },
);

const SortableMultiValueLabel = SortableHandle(
  (props: MultiValueGenericProps<{ value: string; label: string }, true>) => (
    <components.MultiValueLabel {...props} />
  ),
);

const SortableSelect = SortableContainer(AsyncSelect) as React.ComponentClass<
  Props<{ value: string; label: string }, true> & SortableContainerProps
>;

export default function DBColumnMultiSelect({
  values,
  setValues,
  database,
  connectionId,
  table,
}: {
  database: string | undefined;
  table: string | undefined;
  connectionId: string | undefined;
  values: string[];
  setValues: (value: string[]) => void;
}) {
  const { data: columns } = useColumns({
    databaseName: database ?? '',
    tableName: table ?? '',
    connectionId: connectionId ?? '',
  });

  const propertyOptions = (columns ?? []).map((column: { name: string }) => ({
    value: column.name,
    label: column.name,
  }));

  const onChange = (
    selectedOptions: OnChangeValue<(typeof propertyOptions)[number], true>,
  ) => setValues(selectedOptions.map(o => o.value));

  const onSortEnd: SortEndHandler = ({
    oldIndex,
    newIndex,
  }: {
    oldIndex: number;
    newIndex: number;
  }) => {
    const newValue = arrayMove(values, oldIndex, newIndex);
    setValues(newValue);
  };

  return (
    <SortableSelect
      className="ds-select"
      classNamePrefix="ds-react-select"
      // @ts-ignore I don't think it's understanding we're using async select here
      loadOptions={(input: string) => {
        return Promise.resolve([
          { value: undefined, label: 'None' },
          ...propertyOptions
            .filter(v =>
              input.length > 0
                ? v.value.toLowerCase().includes(input.toLowerCase())
                : true,
            )
            .slice(0, 1000), // TODO: better surface too many results... somehow?
        ]);
      }}
      defaultOptions={[
        { value: undefined, label: 'None' },
        ...propertyOptions
          // Filter out index properties on initial dropdown
          .filter(v => v.value.match(/\.\d+(\.|$)/) == null)
          .slice(0, 1000), // TODO: better surface too many results... somehow?
      ]}
      useDragHandle
      // react-sortable-hoc props:
      axis="xy"
      onSortEnd={onSortEnd}
      distance={4}
      // small fix for https://github.com/clauderic/react-sortable-hoc/pull/352:
      getHelperDimensions={({ node }) => node.getBoundingClientRect()}
      // react-select props:
      isMulti
      value={values.flatMap(v => {
        const propertyOption = propertyOptions.find(o => o.value === v);
        return propertyOption != null ? [propertyOption] : [];
      })}
      onChange={onChange}
      components={{
        // @ts-ignore
        MultiValue: SortableMultiValue,
        // @ts-ignore
        MultiValueLabel: SortableMultiValueLabel,
      }}
      closeMenuOnSelect={false}
    />
  );
}
