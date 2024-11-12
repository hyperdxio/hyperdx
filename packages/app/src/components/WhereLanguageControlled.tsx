import { useController, UseControllerProps } from 'react-hook-form';

// Without this, the whereLanguage switch will not cause a re-render
// and the UI will look frozen/stale on language switching
type Props = {
  sqlInput: React.ReactNode;
  luceneInput: React.ReactNode;
};
export default function WhereLanguageControlled(
  props: Props & UseControllerProps<any>,
) {
  const { field } = useController(props);

  return <>{field.value === 'sql' ? props.sqlInput : props.luceneInput}</>;
}
