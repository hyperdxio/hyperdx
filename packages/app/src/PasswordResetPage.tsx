import Link from 'next/link';
import { useRouter } from 'next/router';
import { NextSeo } from 'next-seo';
import { Button, Form } from 'react-bootstrap';

import { SERVER_URL } from './config';
import LandingHeader from './LandingHeader';

export default function PasswordResetPage({
  action,
}: {
  action: 'forgot' | 'reset-password';
}) {
  const router = useRouter();
  const { msg, token } = router.query;

  const title = action === 'forgot' ? 'Forgot password' : 'Reset password';

  const renderForgotPasswordForm = () => (
    <div>
      <Form
        className="text-start"
        action={`${SERVER_URL}/password-reset`}
        method="POST"
      >
        <Form.Label htmlFor="email" className="text-start text-muted fs-7 mb-1">
          Email
        </Form.Label>
        <Form.Control
          id="email"
          name="email"
          type="email"
          placeholder="you@company.com"
          className="border-0 mb-3"
        />
        {msg === 'error' && (
          <div className="text-danger mt-2" data-test-id="auth-error-msg">
            Email is invalid
          </div>
        )}
        {msg === 'success' && (
          <div className="text-success mt-2" data-test-id="auth-error-msg">
            Check your email for a link to reset your password
          </div>
        )}
        <div className="text-center mt-4">
          <Button
            variant="light"
            className="px-6"
            type="submit"
            data-test-id="submit"
            disabled={msg === 'success'}
          >
            Reset Password
          </Button>
        </div>
      </Form>
      <div className="mt-4 text-muted">
        Back to <Link href="/login">Log in</Link>{' '}
      </div>
    </div>
  );

  const renderResetPasswordForm = () => (
    <div>
      <Form
        className="text-start"
        action={`${SERVER_URL}/password-reset/${token}`}
        method="POST"
      >
        <Form.Label
          htmlFor="password"
          className="text-start text-muted fs-7 mb-1"
        >
          Password
        </Form.Label>
        <Form.Control
          id="password"
          name="password"
          type="password"
          className="border-0"
        />
        {msg === 'error' && (
          <div className="text-danger mt-2" data-test-id="auth-error-msg">
            Token expired
          </div>
        )}
        <div className="text-center mt-4">
          <Button
            variant="light"
            className="px-6"
            type="submit"
            data-test-id="submit"
            disabled={msg === 'success'}
          >
            Reset Password
          </Button>
        </div>
      </Form>
    </div>
  );

  return (
    <div className="AuthPage">
      <NextSeo title={title} />
      {/* <div className="w-100">
        <LandingHeader
          activeKey={action === 'forgot' ? '/forgot' : '/reset-password'}
        />
      </div> */}
      <div className="d-flex align-items-center justify-content-center vh-100 p-2">
        <div>
          <div className="text-center mb-4 d-flex">
            <h2 className="me-2">
              {action === 'forgot' ? 'Forgot Password' : 'Reset Password'}
            </h2>
          </div>
          <div
            className="bg-purple rounded py-4 px-3 my-3 mt-2"
            style={{ maxWidth: 400, width: '100%' }}
          >
            <div className="text-center">
              {action === 'forgot' && renderForgotPasswordForm()}
              {action === 'reset-password' && renderResetPasswordForm()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
