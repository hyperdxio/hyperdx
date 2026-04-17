import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';

import ErrorDisplay from '@/components/ErrorDisplay';

interface LoginFormProps {
  /** Default app URL (autofilled, editable by the user). */
  defaultAppUrl: string;
  /** Called with the (possibly changed) appUrl, email, and password. */
  onLogin: (
    appUrl: string,
    email: string,
    password: string,
  ) => Promise<boolean>;
  /** Optional message shown above the form (e.g. "Session expired"). */
  message?: string;
}

type Field = 'appUrl' | 'email' | 'password';

export default function LoginForm({
  defaultAppUrl,
  onLogin,
  message,
}: LoginFormProps) {
  const [field, setField] = useState<Field>('appUrl');
  const [appUrl, setAppUrl] = useState(defaultAppUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmitAppUrl = () => {
    const trimmed = appUrl.trim();
    if (!trimmed) return;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        setError('Invalid URL. Please enter a valid http:// or https:// URL.');
        return;
      }
    } catch {
      setError('Invalid URL. Please enter a valid http:// or https:// URL.');
      return;
    }
    setError(null);
    setAppUrl(trimmed);
    setField('email');
  };

  const handleSubmitEmail = () => {
    if (!email.trim()) return;
    setField('password');
  };

  const handleSubmitPassword = async () => {
    if (!password) return;
    setLoading(true);
    setError(null);
    const ok = await onLogin(appUrl.trim(), email, password);
    setLoading(false);
    if (!ok) {
      setError('Login failed. Check your credentials and server URL.');
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
      {message && <Text color="yellow">{message}</Text>}
      {field !== 'appUrl' && <Text dimColor>Server: {appUrl}</Text>}
      <Text> </Text>

      {error && <ErrorDisplay error={error} severity="error" compact />}

      {loading ? (
        <Text>
          <Spinner type="dots" /> Logging in…
        </Text>
      ) : field === 'appUrl' ? (
        <Box>
          <Text>HyperDX URL: </Text>
          <TextInput
            value={appUrl}
            onChange={setAppUrl}
            onSubmit={handleSubmitAppUrl}
            placeholder="http://localhost:8080"
          />
        </Box>
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
