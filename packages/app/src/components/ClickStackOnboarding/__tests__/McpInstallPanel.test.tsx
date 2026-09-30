import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import McpInstallPanel from '@/components/ClickStackOnboarding/McpInstallPanel';
import { defaultRedact } from '@/components/RevealSnippet/RevealSnippet';

// A realistic-length access key so defaultRedact keeps a visible prefix and
// masks the rest (matching production, where the key is a UUIDv4).
const ACCESS_KEY = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const DEPLOYMENT = {
  apiUrl: 'https://app.example.com/api',
  accessKey: ACCESS_KEY,
};

function renderPanel() {
  return render(
    <MantineProvider>
      <McpInstallPanel deployment={DEPLOYMENT} />
    </MantineProvider>,
  );
}

function codeText(): string {
  // Every masked host renders its snippet in the shared code block.
  return screen.getByTestId('reveal-snippet-code').textContent ?? '';
}

describe('McpInstallPanel secret masking', () => {
  it('masks the access key in the default (Claude Code) command snippet', () => {
    renderPanel();

    const text = codeText();
    // The raw key must never appear in the rendered snippet...
    expect(text).not.toContain(ACCESS_KEY);
    // ...but the masked stand-in (visible prefix + dots) should.
    expect(text).toContain(defaultRedact(ACCESS_KEY));
  });

  it('masks the access key in the JSON fallback (Other) snippet', async () => {
    const user = userEvent.setup();
    renderPanel();

    // Switch to the generic "Other" host, which renders the raw JSON block.
    await user.click(screen.getByRole('radio', { name: /other/i }));

    const text = codeText();
    expect(text).not.toContain(ACCESS_KEY);
    expect(text).toContain(defaultRedact(ACCESS_KEY));
  });

  it('reveals the raw key only after an explicit reveal action', async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(codeText()).not.toContain(ACCESS_KEY);

    await user.click(screen.getByRole('button', { name: /reveal key/i }));

    expect(codeText()).toContain(ACCESS_KEY);
  });
});
