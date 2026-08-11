import { buildAgentEnv } from '@/harness/claudeSpawn';

describe('buildAgentEnv — agent env allowlist', () => {
  const apiKey = 'sk-ant-test';

  it('injects only the Anthropic key as a secret', () => {
    const env = buildAgentEnv(apiKey, {});
    expect(env.ANTHROPIC_API_KEY).toBe(apiKey);
  });

  it('drops the GitHub token and all HDX_EVAL_* runner values', () => {
    const parent = {
      PATH: '/usr/bin',
      HOME: '/home/node',
      HDX_EVAL_GH_TOKEN: 'ghp_supersecret',
      HDX_EVAL_GH_REPO: 'hyperdxio/hyperdx',
      HDX_EVAL_GH_PR: '2857',
      HDX_EVAL_API_URL: 'http://hyperdx:8000',
      HDX_EVAL_CH_URL: 'http://hyperdx:8123',
      AWS_SECRET_ACCESS_KEY: 'leak-me',
      SOME_OTHER_SECRET: 'nope',
    };
    const env = buildAgentEnv(apiKey, parent);

    // The forbidden values must NOT be forwarded to the agent.
    expect(env.HDX_EVAL_GH_TOKEN).toBeUndefined();
    expect(env.HDX_EVAL_GH_REPO).toBeUndefined();
    expect(env.HDX_EVAL_GH_PR).toBeUndefined();
    expect(env.HDX_EVAL_API_URL).toBeUndefined();
    expect(env.HDX_EVAL_CH_URL).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.SOME_OTHER_SECRET).toBeUndefined();

    // No key beginning with HDX_EVAL_ survives.
    expect(Object.keys(env).some(k => k.startsWith('HDX_EVAL_'))).toBe(false);
  });

  it('keeps benign system vars the CLI/Node need', () => {
    const parent = {
      PATH: '/usr/bin:/bin',
      HOME: '/home/node',
      LANG: 'en_US.UTF-8',
      HTTPS_PROXY: 'http://proxy:8080',
      NODE_EXTRA_CA_CERTS: '/etc/ca.pem',
    };
    const env = buildAgentEnv(apiKey, parent);
    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.HOME).toBe('/home/node');
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.HTTPS_PROXY).toBe('http://proxy:8080');
    expect(env.NODE_EXTRA_CA_CERTS).toBe('/etc/ca.pem');
  });

  it('does not forward an inherited ANTHROPIC_API_KEY, only the passed one', () => {
    // Even if the parent env carries a different key, the agent gets exactly
    // the key we pass (single source of truth), never a stray inherited one.
    const env = buildAgentEnv(apiKey, { ANTHROPIC_API_KEY: 'sk-ant-OTHER' });
    expect(env.ANTHROPIC_API_KEY).toBe(apiKey);
  });

  it('omits allowlisted keys that are absent from the parent env', () => {
    const env = buildAgentEnv(apiKey, { PATH: '/usr/bin' });
    // HOME wasn't in the parent, so it must not appear (no empty/undefined key).
    expect('HOME' in env).toBe(false);
    expect(env.PATH).toBe('/usr/bin');
  });
});
