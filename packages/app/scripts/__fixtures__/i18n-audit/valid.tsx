import { Trans, useTranslation } from 'react-i18next';

const documentationUrl = 'https://www.hyperdx.io/docs';

const Field = (_props: {
  description?: string;
  label?: boolean | string;
  title?: string;
}) => null;

export const Valid = () => {
  const { t } = useTranslation();
  const value = 'dynamic value';
  const copied = true;

  return (
    <a
      aria-label={t('actions.save')}
      data-testid="documentation-link"
      href={documentationUrl}
    >
      {t('actions.save')}
      {`${value}`}
      {`${copied ? t('actions.save') : t('actions.cancel')}`}
      {`${t('actions.save') + value}`}
      {`${value}`}
      <input placeholder="https://example.com/path" />
      <Field label />
      <Field
        description={(t('actions.save') as string)!}
        title={copied ? t('actions.save') : t('actions.cancel')}
      />
      <Trans>{'Fallback title'}</Trans>
      <span>&middot;</span>
    </a>
  );
};
