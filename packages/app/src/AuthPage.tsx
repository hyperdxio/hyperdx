import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { NextSeo } from 'next-seo';
import { HTTPError } from 'ky';
import { SubmitHandler, useForm, useWatch } from 'react-hook-form';
import { Trans, useTranslation } from 'react-i18next';
import {
  Button,
  Notification,
  Paper,
  PasswordInput,
  Stack,
  TextInput,
} from '@mantine/core';
import { IconAt, IconLock } from '@tabler/icons-react';

import { useBrandDisplayName } from './theme/ThemeProvider';
import api from './api';
import * as config from './config';
import LandingHeader from './LandingHeader';
import { CheckOrX, PasswordCheck } from './PasswordCheck';

type FormData = {
  email: string;
  password: string;
  confirmPassword: string;
};

export default function AuthPage({ action }: { action: 'register' | 'login' }) {
  const { t } = useTranslation('auth');
  const brandName = useBrandDisplayName();
  const { data: team, isLoading: teamIsLoading } = api.useTeam();
  const router = useRouter();

  const isLoggedIn = Boolean(!teamIsLoading && team);

  useEffect(() => {
    if (isLoggedIn) {
      router.push('/search');
    }
  }, [isLoggedIn, router]);

  const isRegister = action === 'register';
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    control,
  } = useForm<FormData>({
    reValidateMode: 'onSubmit',
  });

  const { err, msg } = router.query;

  const { data: installation } = api.useInstallation();
  const registerPassword = api.useRegisterPassword();

  const verificationSent = msg === 'verify';

  const title = t(isRegister ? 'register.browserTitle' : 'login.browserTitle', {
    brandName,
  });

  useEffect(() => {
    // If an OSS user accidentally lands on /register after already creating a team
    // redirect them to login instead
    if (config.IS_OSS && installation?.isTeamExisting === true && isRegister) {
      router.push('/login');
    }
  }, [installation, isRegister, router]);

  const currentPassword = useWatch({
    control,
    name: 'password',
    defaultValue: '',
  });
  const confirmPassword = useWatch({
    control,
    name: 'confirmPassword',
    defaultValue: '',
  });

  const confirmPass = () => {
    return currentPassword === confirmPassword;
  };

  const onSubmit: SubmitHandler<FormData> = data =>
    registerPassword.mutate(
      {
        email: data.email,
        password: data.password,
        confirmPassword: data.confirmPassword,
      },
      {
        onSuccess: () => router.push('/search'),
        onError: async error => {
          if (error instanceof HTTPError) {
            const jsonData = await error.response.json();

            if (Array.isArray(jsonData) && jsonData[0]?.errors?.issues) {
              return jsonData[0].errors.issues.forEach((issue: any) => {
                setError(issue.path[0], {
                  type: issue.code,
                  message: issue.message,
                });
              });
            }
          }
          setError('root', {
            type: 'manual',
            message: t('errors.unexpected'),
          });
        },
      },
    );

  const form = isRegister
    ? {
        controller: { onSubmit: handleSubmit(onSubmit) },
        email: register('email', { required: true }),
        password: register('password', { required: true }),
        confirmPassword: register('confirmPassword', { required: true }),
      }
    : {
        controller: {
          action: `/api/login/password`,
          method: 'POST',
        },
        email: { name: 'email' },
        password: { name: 'password' },
      };

  return (
    <div className="AuthPage">
      <NextSeo title={title} />
      <LandingHeader activeKey={`/${action}`} fixed />
      <div className="d-flex justify-content-center align-items-center vh-100">
        <div style={{ width: '26rem' }}>
          <div className="text-center mb-2 fs-5 " style={{ marginTop: -30 }}>
            <Trans
              t={t}
              i18nKey={
                config.IS_OSS && isRegister
                  ? 'register.setupHeading'
                  : isRegister
                    ? 'register.heading'
                    : 'login.heading'
              }
              values={{ brandName }}
              components={{
                brand: <span className="text-brand fw-bold" />,
              }}
            />
          </div>
          {action === 'login' && (
            <div className="text-center mb-2 ">{t('login.title')}</div>
          )}
          {isRegister && config.IS_OSS === true && (
            <div className="text-center mb-2 text-muted">
              {t('register.intro')}
            </div>
          )}
          <form className="text-start mt-4" {...form.controller}>
            <Stack gap="xl">
              <Paper p={34} shadow="md" radius="md">
                <Stack gap="lg">
                  <TextInput
                    label={t('common.email')}
                    size="md"
                    withAsterisk={false}
                    placeholder={t('common.emailPlaceholder')}
                    type="email"
                    leftSection={<IconAt size={18} />}
                    error={errors.email?.message}
                    required
                    {...form.email}
                  />
                  <PasswordInput
                    size="md"
                    label={t('common.password')}
                    withAsterisk={false}
                    leftSection={<IconLock size={16} />}
                    error={errors.password?.message}
                    required
                    placeholder={t('common.password')}
                    {...form.password}
                  />
                  {isRegister && (
                    <>
                      <PasswordInput
                        label={
                          <CheckOrX
                            handler={confirmPass}
                            password={currentPassword}
                          >
                            {t('common.confirmPassword')}
                          </CheckOrX>
                        }
                        size="md"
                        required
                        withAsterisk={false}
                        leftSection={<IconLock size={16} />}
                        error={errors.confirmPassword?.message}
                        placeholder={t('common.confirmPassword')}
                        {...form.confirmPassword}
                      />
                      <Notification withCloseButton={false}>
                        <PasswordCheck password={currentPassword} />
                      </Notification>
                    </>
                  )}
                  <Button
                    mt={4}
                    type="submit"
                    variant="primary"
                    size="md"
                    disabled={isSubmitting || verificationSent}
                    loading={isSubmitting}
                    data-test-id="submit"
                  >
                    {config.IS_OSS && isRegister
                      ? t('register.create')
                      : isRegister
                        ? t('register.submit')
                        : t('login.submit')}
                  </Button>
                </Stack>
              </Paper>

              {err != null && (
                <Notification
                  withCloseButton={false}
                  withBorder
                  color="red"
                  data-test-id="auth-error-msg"
                >
                  {err === 'missing'
                    ? t('errors.validCredentials')
                    : err === 'invalid'
                      ? t('errors.invalidCredentials')
                      : err === 'authFail'
                        ? t('errors.loginFailed')
                        : err === 'passwordAuthNotAllowed'
                          ? t('errors.passwordNotAllowed')
                          : err === 'teamAlreadyExists'
                            ? t('errors.teamExists')
                            : t('errors.unknown')}
                </Notification>
              )}

              {verificationSent && (
                <Notification
                  withCloseButton={false}
                  withBorder
                  color="green"
                  data-test-id="auth-msg"
                >
                  {t('register.verificationSent')}
                </Notification>
              )}

              {isRegister && config.IS_OSS === false && (
                <div data-test-id="login-link" className="text-center fs-8 ">
                  <Trans
                    t={t}
                    i18nKey="register.loginPrompt"
                    components={{ login: <Link href="/login" /> }}
                  />
                </div>
              )}
              {action === 'login' && config.IS_OSS === false && (
                <div data-test-id="register-link" className="text-center fs-8 ">
                  <Trans
                    t={t}
                    i18nKey="login.registrationPrompt"
                    components={{ register: <Link href="/register" /> }}
                  />
                </div>
              )}
            </Stack>
          </form>
        </div>
      </div>
    </div>
  );
}
