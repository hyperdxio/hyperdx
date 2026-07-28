const Widget = (_props: {
  description?: string;
  label?: string;
  title?: string;
}) => null;

const t = (key: string) => key;

export const Invalid = () => {
  const copied = true;
  const name = 'Taylor';
  const notification = { message: 'Saved successfully' };
  const copyOptions = {
    description: copied ? 'Added filter' : 'Edited filter',
    label: 'Add ' + 'filter',
    placeholder: 'Filter query' satisfies string,
    title: ('Edit filter' as string)!,
  };

  return (
    <section>
      Welcome back
      {'Warning: Alerts require attention'}
      {`Hello ${name}`}
      {`${copied ? 'Created' : 'Updated'}`}
      {`${'Add ' + 'filter'}`}
      {`${('Wrapped filter' as string)!}`}
      {`${t('actions.save')}`}
      {`${name}`}
      {copied ? 'Copied!' : 'Copy'}
      {'Add filter'}
      {'Edit ' + 'filter'}
      {'Copy ' + name}
      <input
        aria-label="Close"
        placeholder="Search"
        title={copied ? 'Add filter' : 'Edit filter'}
      />
      <Widget
        description={'Create filter' as string}
        label={('Update filter' satisfies string)!}
      />
      <output>{notification.message}</output>
      <output>{copyOptions.label}</output>
    </section>
  );
};
