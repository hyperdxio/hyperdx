import { useRouter } from 'next/router';
import { Trans } from 'next-i18next/pages';
import { NextSeo } from 'next-seo';
import { Button, Paper, Text, TextInput } from '@mantine/core';

import { useBrandDisplayName } from './theme/ThemeProvider';

export default function JoinTeam() {
  const router = useRouter();
  const brandName = useBrandDisplayName();
  const { err, token } = router.query;

  return (
    <div className="AuthPage">
      <NextSeo title={`Join Team - ${brandName}`} />
      <div className="d-flex align-items-center justify-content-center vh-100 p-2">
        <div>
          <div className="text-center mb-4">
            <h2 className="me-2 text-center">
              <Trans>Join Team</Trans>
            </h2>
          </div>
          <Paper p="xl" withBorder>
            <div className="text-center">
              <form
                className="text-start"
                action={`/api/team/setup/${token}`}
                method="POST"
              >
                <TextInput
                  id="password"
                  name="password"
                  type="password"
                  label="Password"
                  styles={{
                    label: {
                      fontSize: '0.875rem',
                      color: 'var(--color-text-muted)',
                      marginBottom: 4,
                    },
                  }}
                />
                {err != null && (
                  <Text c="red" mt="sm" data-test-id="auth-error-msg">
                    {err === 'invalid'
                      ? 'Password is invalid'
                      : 'Unknown error occurred, please try again later.'}
                  </Text>
                )}
                <div className="text-center mt-4">
                  <Button
                    variant="primary"
                    className="px-6"
                    type="submit"
                    data-test-id="submit"
                  >
                    <Trans>Setup a password</Trans>
                  </Button>
                </div>
              </form>
            </div>
          </Paper>
        </div>
      </div>
    </div>
  );
}
