import { useRouter } from 'next/router';
import { NextSeo } from 'next-seo';
import { Button, Form } from 'react-bootstrap';

export default function JoinTeam() {
  const router = useRouter();
  const { err, token } = router.query;

  return (
    <div className="AuthPage">
      <NextSeo title="Join Team - HyperDX" />
      <div className="d-flex align-items-center justify-content-center vh-100 p-2">
        <div>
          <div className="text-center mb-4">
            <h2 className="me-2 text-center">Join Team</h2>
          </div>
          <div
            className="bg-purple rounded py-4 px-3 my-3 mt-2"
            style={{ maxWidth: 400, width: '100%' }}
          >
            <div className="text-center">
              <Form
                className="text-start"
                action={`/api/team/setup/${token}`}
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
                {err != null && (
                  <div
                    className="text-danger mt-2"
                    data-test-id="auth-error-msg"
                  >
                    {err === 'invalid'
                      ? 'Password is invalid'
                      : 'Unknown error occurred, please try again later.'}
                  </div>
                )}
                <div className="text-center mt-4">
                  <Button
                    variant="light"
                    className="px-6"
                    type="submit"
                    data-test-id="submit"
                  >
                    Setup a password
                  </Button>
                </div>
              </Form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
