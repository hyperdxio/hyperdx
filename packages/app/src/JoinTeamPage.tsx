import { useState } from 'react';
import { useRouter } from 'next/router';
import { NextSeo } from 'next-seo';
import {
  Button,
  List,
  Notification,
  Paper,
  Text,
  TextInput,
} from '@mantine/core';

import { useBrandDisplayName } from './theme/ThemeProvider';
import { PasswordCheck } from './PasswordCheck';

export default function JoinTeam() {
  const router = useRouter();
  const brandName = useBrandDisplayName();
  const { err, reason, token } = router.query;
  const [password, setPassword] = useState('');

  const invalidReasons =
    err === 'invalid'
      ? (Array.isArray(reason)
          ? reason
          : reason != null
            ? [reason]
            : []
        ).filter(r => r.length > 0)
      : [];

  return (
    <div className="AuthPage">
      <NextSeo title={`Join Team - ${brandName}`} />
      <div className="d-flex align-items-center justify-content-center vh-100 p-2">
        <div style={{ width: '26rem', maxWidth: '100%' }}>
          <div className="text-center mb-4">
            <h2 className="me-2 text-center">Join Team</h2>
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
                  value={password}
                  onChange={event => setPassword(event.currentTarget.value)}
                  styles={{
                    label: {
                      fontSize: '0.875rem',
                      color: 'var(--color-text-muted)',
                      marginBottom: 4,
                    },
                  }}
                />
                <Notification withCloseButton={false} mt="sm">
                  <PasswordCheck password={password} />
                </Notification>
                {err != null && (
                  <div
                    data-test-id="auth-error-msg"
                    style={{ overflowWrap: 'anywhere' }}
                  >
                    {err !== 'invalid' ? (
                      <Text c="red" mt="sm">
                        Unknown error occurred, please try again later.
                      </Text>
                    ) : invalidReasons.length > 1 ? (
                      <List c="red" size="sm" mt="sm" spacing={4}>
                        {invalidReasons.map(r => (
                          <List.Item key={r}>{r}</List.Item>
                        ))}
                      </List>
                    ) : (
                      <Text c="red" mt="sm">
                        {invalidReasons[0] ??
                          'Password does not meet the requirements.'}
                      </Text>
                    )}
                  </div>
                )}
                <div className="text-center mt-4">
                  <Button
                    variant="primary"
                    className="px-6"
                    type="submit"
                    data-test-id="submit"
                  >
                    Setup a password
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
