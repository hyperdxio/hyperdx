import { useRouter } from 'next/router';
import { NextSeo } from 'next-seo';
import {
  Button,
  Card,
  Center,
  PasswordInput,
  Stack,
  Text,
} from '@mantine/core';

import { SERVER_URL } from './config';

export default function JoinTeam() {
  const router = useRouter();
  const { err, token } = router.query;

  return (
    <div className="AuthPage">
      <NextSeo title="Join Team - HyperDX" />
      <Center h="90vh">
        <Card w={300}>
          <form action={`${SERVER_URL}/team/setup/${token}`} method="POST">
            <Stack>
              <Text>Join team</Text>
              <PasswordInput
                name="password"
                placeholder="Password"
                required
                error={
                  err
                    ? err === 'invalid'
                      ? 'Password is invalid'
                      : 'Unknown error occurred, please try again later.'
                    : null
                }
              />
              <Button type="submit" variant="light" fullWidth>
                Setup a password
              </Button>
            </Stack>
          </form>
        </Card>
      </Center>
    </div>
  );
}
