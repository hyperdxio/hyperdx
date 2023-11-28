import { useForm, SubmitHandler } from 'react-hook-form';
import { Button, Form } from 'react-bootstrap';
import { NextSeo } from 'next-seo';
import { API_SERVER_URL } from './config';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import Link from 'next/link';
import cx from 'classnames';

import { PasswordCheck, CheckOrX } from './PasswordCheck';
import LandingHeader from './LandingHeader';
import * as config from './config';
import api from './api';

type FormData = {
  email: string;
  password: string;
  confirmPassword: string;
};

export default function AuthPage({ action }: { action: 'register' | 'login' }) {
  const isRegister = action === 'register';
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    watch,
  } = useForm<FormData>({
    reValidateMode: 'onSubmit',
  });
  const router = useRouter();
  const { err, msg } = router.query;

  const { data: installation } = api.useInstallation();
  const registerPassword = api.useRegisterPassword();

  const verificationSent = msg === 'verify';

  const title = `HyperDX - ${isRegister ? 'Sign up' : 'Login'}`;

  useEffect(() => {
    // If an OSS user accidentally lands on /register after already creating a team
    // redirect them to login instead
    if (config.IS_OSS && installation?.isTeamExisting === true && isRegister) {
      router.push('/login');
    }
  }, [installation, isRegister, router]);

  const currentPassword = watch('password', '');
  const confirmPassword = watch('confirmPassword', '');

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
          const jsonData = await error.response.json();

          if (Array.isArray(jsonData) && jsonData[0]?.errors?.issues) {
            return jsonData[0].errors.issues.forEach((issue: any) => {
              setError(issue.path[0], {
                type: issue.code,
                message: issue.message,
              });
            });
          }

          setError('root', {
            type: 'manual',
            message: 'An unexpected error occurred, please try again later.',
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
          action: `${API_SERVER_URL}/login/password`,
          method: 'POST',
        },
        email: { name: 'email' },
        password: { name: 'password' },
      };

  return (
    <div className="AuthPage">
      <NextSeo title={title} />
      <LandingHeader activeKey={`/${action}`} />
      <div className="d-flex align-items-center justify-content-center vh-100 p-2">
        <div>
          <div className="text-center mb-4 fs-5">
            {config.IS_OSS && isRegister
              ? 'Setup '
              : isRegister
              ? 'Register for '
              : 'Login to '}
            <span className="text-success fw-bold">HyperDX</span>
          </div>
          {action === 'login' && (
            <div className="text-center mb-4 text-muted">Welcome back!</div>
          )}
          {isRegister && config.IS_OSS === true && (
            <div className="text-center mb-4 text-muted">
              Let{"'"}s create your user account.
            </div>
          )}
          <div
            className="bg-hdx-dark rounded py-4 px-3 my-3 mt-2 fs-7"
            style={{ maxWidth: 400, minWidth: 400, width: '100%' }}
          >
            <div className="text-center">
              <Form className="text-start" {...form.controller}>
                <Form.Label
                  htmlFor="email"
                  className="text-start text-muted fs-7.5 mb-1"
                >
                  Email
                </Form.Label>
                <Form.Control
                  data-test-id="form-email"
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  className="border-0 mb-3"
                  {...form.email}
                />
                <Form.Label
                  htmlFor="password"
                  className="text-start text-muted fs-7.5 mb-1"
                >
                  Password
                </Form.Label>
                <Form.Control
                  data-test-id="form-password"
                  id="password"
                  type="password"
                  className={cx('border-0', {
                    'mb-3': isRegister,
                  })}
                  {...form.password}
                />
                {isRegister && (
                  <>
                    <Form.Label
                      htmlFor="confirmPassword"
                      className="text-start text-muted fs-7.5 mb-1"
                    >
                      <CheckOrX
                        handler={confirmPass}
                        password={currentPassword}
                      >
                        Confirm Password
                      </CheckOrX>
                    </Form.Label>
                    <Form.Control
                      data-test-id="form-confirm-password"
                      id="confirmPassword"
                      type="password"
                      className="border-0 mb-2"
                      {...form.confirmPassword}
                    />
                    <PasswordCheck password={currentPassword} />
                  </>
                )}
                {isRegister && Object.keys(errors).length > 0 && (
                  <div className="text-danger mt-2">
                    {Object.values(errors).map((error, index) => (
                      <div key={index}>{error.message}</div>
                    ))}
                  </div>
                )}
                {err != null && (
                  <div
                    className="text-danger mt-2"
                    data-test-id="auth-error-msg"
                  >
                    {err === 'missing'
                      ? 'Please provide a valid email and password'
                      : err === 'invalid'
                      ? 'Email or password is invalid'
                      : err === 'authFail'
                      ? 'Failed to login with email and password, please try again.'
                      : err === 'passwordAuthNotAllowed'
                      ? 'Password authentication is not allowed by your team admin.'
                      : err === 'teamAlreadyExists'
                      ? 'Team already exists, please login instead.'
                      : 'Unkown error occured, please try again later.'}
                  </div>
                )}
                {verificationSent && (
                  <div className="text-success mt-2" data-test-id="auth-msg">
                    Sent verification email! Please check your email inbox
                  </div>
                )}
                <div className="text-center mt-4">
                  <Button
                    variant="light"
                    className="px-6"
                    type="submit"
                    data-test-id="submit"
                    disabled={isSubmitting || verificationSent}
                  >
                    {isRegister ? 'Register' : 'Login'}
                  </Button>
                </div>
              </Form>
              {isRegister && config.IS_OSS === false && (
                <div data-test-id="login-link" className="mt-4 text-muted">
                  Already have an account? <Link href="/login">Log in</Link>{' '}
                  instead.
                </div>
              )}
              {action === 'login' && config.IS_OSS === false && (
                <div data-test-id="register-link" className="mt-4 text-muted">
                  Don{"'"}t have an account yet?{' '}
                  <Link href="/register">Register</Link> instead.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
