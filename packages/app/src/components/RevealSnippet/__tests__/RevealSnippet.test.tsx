import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RevealSnippet } from '@/components/RevealSnippet/RevealSnippet';

const REAL_KEY = 'abcdef0123456789deadbeefcafef00d';
const SNIPPET = `Authorization: Bearer ${REAL_KEY}`;

function renderSnippet(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('RevealSnippet', () => {
  it('masks the secret by default and reveals it on toggle', async () => {
    const user = userEvent.setup();
    renderSnippet(
      <RevealSnippet value={SNIPPET} secrets={[[REAL_KEY, 'abcdef••••']]}>
        <RevealSnippet.Reveal />
        <RevealSnippet.Code />
      </RevealSnippet>,
    );

    expect(screen.queryByText(new RegExp(REAL_KEY))).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reveal key/i }));

    expect(screen.getByText(new RegExp(REAL_KEY))).toBeInTheDocument();
  });

  it('shows the value as-is when secrets is omitted (no auto-masking)', () => {
    // Regression: omitting `secrets` must NOT mask the value. The safe
    // default is a plain, fully-visible snippet.
    renderSnippet(
      <RevealSnippet value={SNIPPET}>
        <RevealSnippet.Reveal />
        <RevealSnippet.Code />
      </RevealSnippet>,
    );

    expect(screen.getByText(new RegExp(REAL_KEY))).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /reveal key/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the value as-is when secrets is empty', () => {
    renderSnippet(
      <RevealSnippet value={SNIPPET} secrets={[]}>
        <RevealSnippet.Reveal />
        <RevealSnippet.Code />
      </RevealSnippet>,
    );

    expect(screen.getByText(new RegExp(REAL_KEY))).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /reveal key/i }),
    ).not.toBeInTheDocument();
  });

  it('masks a bare-string secret via defaultRedact and reveals on toggle', async () => {
    const user = userEvent.setup();
    renderSnippet(
      <RevealSnippet value={REAL_KEY} secrets={[REAL_KEY]}>
        <RevealSnippet.Reveal />
        <RevealSnippet.Code />
      </RevealSnippet>,
    );

    // Bare string → whole value masked, but the visible prefix remains.
    expect(screen.queryByText(REAL_KEY)).not.toBeInTheDocument();
    expect(screen.getByText(/^abcd•+$/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reveal key/i }));

    expect(screen.getByText(REAL_KEY)).toBeInTheDocument();
  });

  it('masks a bare-string secret as a substring of a larger snippet', () => {
    renderSnippet(
      <RevealSnippet value={SNIPPET} secrets={[REAL_KEY]}>
        <RevealSnippet.Code />
      </RevealSnippet>,
    );

    // Only the key is masked; the surrounding text stays readable.
    expect(screen.queryByText(new RegExp(REAL_KEY))).not.toBeInTheDocument();
    expect(
      screen.getByText(/^Authorization: Bearer abcd•+$/),
    ).toBeInTheDocument();
  });

  it('renders the snippet unchanged when a null secret is passed (no throw)', () => {
    // Regression: callers pass `secrets={[maybeSecret]}` where the
    // entry can be `null` (e.g. a CHC deployment has no key). This must
    // not throw while destructuring; the snippet renders as-is.
    renderSnippet(
      <RevealSnippet value={SNIPPET} secrets={[null]}>
        <RevealSnippet.Reveal />
        <RevealSnippet.Code />
      </RevealSnippet>,
    );

    expect(screen.getByText(new RegExp(REAL_KEY))).toBeInTheDocument();
  });

  it('omits the reveal toggle when there is nothing to reveal', () => {
    renderSnippet(
      <RevealSnippet value={SNIPPET} secrets={[null]}>
        <RevealSnippet.Reveal />
        <RevealSnippet.Code />
      </RevealSnippet>,
    );

    expect(
      screen.queryByRole('button', { name: /reveal key/i }),
    ).not.toBeInTheDocument();
  });

  it('omits the reveal toggle when canReveal is false but still copies', () => {
    renderSnippet(
      <RevealSnippet
        value={SNIPPET}
        secrets={[[REAL_KEY, 'abcdef••••']]}
        canReveal={false}
      >
        <RevealSnippet.Reveal />
        <RevealSnippet.Copy />
        <RevealSnippet.Code />
      </RevealSnippet>,
    );

    expect(screen.queryByText(new RegExp(REAL_KEY))).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /reveal key/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('renders a custom Reveal via render prop and still toggles', async () => {
    const user = userEvent.setup();
    renderSnippet(
      <RevealSnippet value={SNIPPET} secrets={[[REAL_KEY, 'abcdef••••']]}>
        <RevealSnippet.Reveal>
          {({ revealed, toggle, label }) => (
            <button type="button" onClick={toggle} data-testid="custom-reveal">
              {revealed ? 'shown' : 'hidden'}: {label}
            </button>
          )}
        </RevealSnippet.Reveal>
        <RevealSnippet.Code />
      </RevealSnippet>,
    );

    // Default button is overridden — only the custom control is present.
    const custom = screen.getByTestId('custom-reveal');
    expect(custom).toHaveTextContent('hidden: Reveal key');
    expect(screen.queryByText(new RegExp(REAL_KEY))).not.toBeInTheDocument();

    await user.click(custom);

    expect(custom).toHaveTextContent('shown: Hide key');
    expect(screen.getByText(new RegExp(REAL_KEY))).toBeInTheDocument();
  });

  it('renders nothing for a custom Reveal when there is nothing to reveal', () => {
    // The "nothing to reveal" gating stays in the component, so a custom
    // renderer never has to re-implement it.
    renderSnippet(
      <RevealSnippet value={SNIPPET} secrets={[null]}>
        <RevealSnippet.Reveal>
          {({ toggle }) => (
            <button type="button" onClick={toggle} data-testid="custom-reveal">
              toggle
            </button>
          )}
        </RevealSnippet.Reveal>
        <RevealSnippet.Code />
      </RevealSnippet>,
    );

    expect(screen.queryByTestId('custom-reveal')).not.toBeInTheDocument();
  });

  it('re-masks when the value changes after being revealed (key rotation)', async () => {
    // Regression: a revealed key that is then rotated must NOT leak the new
    // value. The component re-hides on value change so a fresh reveal is
    // required for the rotated key.
    const user = userEvent.setup();
    const ROTATED_KEY = 'ffffffff1111111122222222deadbeef';

    const ui = (key: string) => (
      <RevealSnippet value={key} secrets={[key]}>
        <RevealSnippet.Reveal />
        <RevealSnippet.Code />
      </RevealSnippet>
    );

    const { rerender } = render(
      <MantineProvider>{ui(REAL_KEY)}</MantineProvider>,
    );

    // Reveal the original key.
    await user.click(screen.getByRole('button', { name: /reveal key/i }));
    expect(screen.getByText(REAL_KEY)).toBeInTheDocument();

    // Rotate: same instance, new value. It must come back masked.
    rerender(<MantineProvider>{ui(ROTATED_KEY)}</MantineProvider>);

    expect(screen.queryByText(ROTATED_KEY)).not.toBeInTheDocument();
    expect(screen.getByText(/^ffff•+$/)).toBeInTheDocument();
    // And the reveal toggle is back to its hidden label.
    expect(
      screen.getByRole('button', { name: /reveal key/i }),
    ).toBeInTheDocument();
  });
});
