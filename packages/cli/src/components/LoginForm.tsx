import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';

import ErrorDisplay from '@/components/ErrorDisplay';

interface LoginFormProps {
  appUrl: string;
  onLogin: (email: string, password: string) => Promise<boolean>;
}

type Field = 'email' | 'password';

export default function LoginForm({ appUrl, onLogin }: LoginFormProps) {
  const [field, setField] = useState<Field>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmitEmail = () => {
    if (!email.trim()) return;
    setField('password');
  };

  const handleSubmitPassword = async () => {
    if (!password) return;
    setLoading(true);
    setError(null);
    const ok = await onLogin(email, password);
    setLoading(false);
    if (!ok) {
      setError('Login failed. Check your email and password.');
      setField('email');
      setEmail('');
      setPassword('');
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        HyperDX TUI — Login
      </Text>
      <Text dimColor>Server: {appUrl}</Text>
      <Text> </Text>

      {error && <ErrorDisplay error={error} severity="error" compact />}

      {loading ? (
        <Text>
          <Spinner type="dots" /> Logging in…
        </Text>
      ) : field === 'email' ? (
        <Box>
          <Text>Email: </Text>
          <TextInput
            value={email}
            onChange={setEmail}
            onSubmit={handleSubmitEmail}
          />
        </Box>
      ) : (
        <Box>
          <Text>Password: </Text>
          <TextInput
            value={password}
            onChange={setPassword}
            onSubmit={handleSubmitPassword}
            mask="*"
          />
        </Box>
      )}
    </Box>
  );
}
