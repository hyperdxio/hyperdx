import { Button, Form } from 'react-bootstrap';
import { NextSeo } from 'next-seo';
import { API_SERVER_URL } from './config';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import Link from 'next/link';

import LandingHeader from './LandingHeader';
import * as config from './config';
import api from './api';

export default function AuthPage({ action }: { action: 'register' | 'login' }) {
  const router = useRouter();
  const { err, msg } = router.query;

  const { data: installation } = api.useInstallation();

  const verificationSent = msg === 'verify';

  const title = `HyperDX - ${action === 'register' ? 'Sign up' : 'Login'}`;

  useEffect(() => {
    // If an OSS user accidentally lands on /register after already creating a team
    // redirect them to login instead
    if (
      config.IS_OSS &&
      installation?.isTeamExisting === true &&
      action === 'register'
    ) {
      router.push('/login');
    }
  }, [installation, action, router]);

  return (
    <div className="AuthPage">
      <NextSeo title={title} />
      <LandingHeader activeKey={`/${action}`} />
      <div className="d-flex align-items-center justify-content-center vh-100 p-2">
        <div>
          <div className="text-center mb-4 fs-5">
            {config.IS_OSS && action === 'register'
              ? 'Setup '
              : action === 'register'
              ? 'Register for '
              : 'Login to '}
            <span className="text-success fw-bold">HyperDX</span>
          </div>
          {action === 'login' && (
            <div className="text-center mb-4 text-muted">Welcome back!</div>
          )}
          {action === 'register' && config.IS_OSS === true && (
            <div className="text-center mb-4 text-muted">
              Let{"'"}s create your user account.
            </div>
          )}
          <div
            className="bg-hdx-dark rounded py-4 px-3 my-3 mt-2 fs-7"
            style={{ maxWidth: 400, minWidth: 400, width: '100%' }}
          >
            <div className="text-center">
              <Form
                className="text-start"
                action={
                  action === 'register'
                    ? `${API_SERVER_URL}/register/password`
                    : `${API_SERVER_URL}/login/password`
                }
                method="POST"
              >
                <Form.Label
                  htmlFor="email"
                  className="text-start text-muted fs-7.5 mb-1"
                >
                  Email
                </Form.Label>
                <Form.Control
                  data-test-id="form-email"
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@company.com"
                  className="border-0 mb-3"
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
                  name="password"
                  type="password"
                  className="border-0"
                />
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
                    disabled={verificationSent}
                  >
                    {action === 'register' ? 'Register' : 'Login'}
                  </Button>
                </div>
              </Form>
              {action === 'register' && config.IS_OSS === false && (
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
