import { createContext, ReactNode, use, useMemo, useState } from 'react';
import {
  ActionIcon,
  Button,
  CopyButton,
  Group,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconCheck, IconCopy, IconEye, IconEyeOff } from '@tabler/icons-react';

import styles from './RevealSnippet.module.scss';

/**
 * A `[real, redacted]` pair: the real value copy hands back, and the
 * shoulder-surfing-safe stand-in shown until revealed — e.g.
 * `['hdx_ing_9f8a7b6c...', 'hdx_api_xxx']`.
 */
export type Secret = readonly [real: string, redacted: string];

/**
 * A secret to mask. Either an explicit `[real, redacted]` pair, or a bare
 * string (the whole value is the secret) that is auto-redacted via
 * `defaultRedact` — so `secrets={[apiKey]}` masks `apiKey` as prefix + dots.
 */
export type SecretInput = Secret | string;

interface RevealSnippetContextValue {
  realText: string;
  redactedText: string;
  revealed: boolean;
  /** Toggle between real and redacted. Null when reveal is disabled. */
  toggle: (() => void) | null;
  hasSecrets: boolean;
}

const RevealSnippetContext = createContext<RevealSnippetContextValue | null>(
  null,
);

const NO_SECRETS: readonly Secret[] = [];

function useRevealSnippet(component: string): RevealSnippetContextValue {
  const ctx = use(RevealSnippetContext);
  if (!ctx) {
    throw new Error(`${component} must be used within <RevealSnippet>`);
  }
  return ctx;
}

/** Characters of the value kept visible in the default auto-redaction. */
const DEFAULT_VISIBLE_PREFIX = 4;

/**
 * Masks a whole value as prefix + dots, padded to the original length so the
 * field width doesn't jump on reveal. Applied automatically to bare-string
 * `secrets` entries (the whole value is the secret, e.g. an API key).
 */
export function defaultRedact(value: string): string {
  const prefix = value.slice(0, DEFAULT_VISIBLE_PREFIX);
  const maskedLength = Math.max(0, value.length - prefix.length);
  return `${prefix}${'•'.repeat(maskedLength)}`;
}

/**
 * Normalizes a caller-supplied secret into a usable `[real, redacted]` pair,
 * or `null` when there's nothing to mask. A bare string is auto-redacted via
 * `defaultRedact`; nullable entries (e.g. a CHC deployment has no key) and
 * empty reals are dropped rather than throwing.
 */
function normalizeSecret(entry: SecretInput | null | undefined): Secret | null {
  if (typeof entry === 'string') {
    return entry ? [entry, defaultRedact(entry)] : null;
  }
  return Array.isArray(entry) && entry[0] ? entry : null;
}

/** Replaces every occurrence of each secret's real value with its stand-in. */
function redact(text: string, secrets: readonly Secret[]): string {
  return secrets.reduce<string>(
    (acc, [real, redacted]) => acc.split(real).join(redacted),
    text,
  );
}

interface RevealSnippetProps {
  /** Snippet text with real secret values already inlined. */
  value: string;
  /**
   * Secrets to mask in `value`. Each entry is either an explicit
   * `[real, redacted]` pair, or a bare string whose whole value is masked
   * via `defaultRedact` (e.g. `secrets={[apiKey]}` for an API-key field).
   * Nullable entries are skipped, so `secrets={[maybeKey]}` is safe. Omitted
   * or empty → nothing is masked and the snippet is a plain copyable block.
   */
  secrets?: readonly (SecretInput | null)[];
  /** When false, the snippet stays redacted and reveal is unavailable. */
  canReveal?: boolean;
  children: ReactNode;
}

/**
 * Reveal-aware snippet. Holds the real value plus its secrets and shares
 * reveal state with its subcomponents (`Reveal`, `Code`, `Input`, `Copy`)
 * via context, so the surrounding layout is up to the caller.
 */
export function RevealSnippet({
  value,
  secrets,
  canReveal = true,
  children,
}: RevealSnippetProps) {
  const [revealed, setRevealed] = useState(false);

  // Normalize entries to pairs (bare strings auto-redacted), dropping the
  // ones with nothing to mask. Omitted/empty → nothing is masked (safe,
  // least-surprising default).
  const resolvedSecrets = useMemo<readonly Secret[]>(() => {
    if (!secrets) return NO_SECRETS;
    return secrets.map(normalizeSecret).filter((s): s is Secret => s !== null);
  }, [secrets]);

  const redactedText = useMemo(
    () => redact(value, resolvedSecrets),
    [value, resolvedSecrets],
  );

  const hasSecrets = resolvedSecrets.length > 0;
  const canToggle = canReveal && hasSecrets;

  const ctx = useMemo<RevealSnippetContextValue>(
    () => ({
      realText: value,
      redactedText,
      // Gate on canToggle so a stale revealed=true can't leak after
      // canReveal flips to false.
      revealed: canToggle && revealed,
      toggle: canToggle ? () => setRevealed(v => !v) : null,
      hasSecrets,
    }),
    [value, redactedText, revealed, canToggle, hasSecrets],
  );

  return <RevealSnippetContext value={ctx}>{children}</RevealSnippetContext>;
}

/** State handed to a custom `Reveal` renderer. */
export interface RevealRenderProps {
  revealed: boolean;
  toggle: () => void;
  label: string;
}

interface RevealProps {
  /** Label when hidden. Default "Reveal key". */
  showLabel?: string;
  /** Label when shown. Default "Hide key". */
  hideLabel?: string;
  /** Render-prop override; keeps the state + gating, replaces the button. */
  children?: (props: RevealRenderProps) => ReactNode;
}

/**
 * Toggle that flips the snippet between redacted and real. Renders
 * nothing when there is nothing to reveal or `canReveal` is false, so a
 * custom renderer never has to re-implement that gating.
 */
function Reveal({
  showLabel = 'Reveal key',
  hideLabel = 'Hide key',
  children,
}: RevealProps) {
  const { revealed, toggle } = useRevealSnippet('RevealSnippet.Reveal');
  if (!toggle) return null;
  const label = revealed ? hideLabel : showLabel;

  if (children) {
    return <>{children({ revealed, toggle, label })}</>;
  }

  return (
    <Button
      onClick={toggle}
      variant="subtle"
      color="gray"
      c="inherit"
      size="xs"
      className={styles.reveal}
      aria-label={label}
      leftSection={revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
    >
      {label}
    </Button>
  );
}

interface CodeProps {
  /** Wrap long lines instead of scrolling horizontally. Default true. */
  wrap?: boolean;
}

/** The snippet body, as a code block. Redacted until revealed. */
function Code({ wrap = true }: CodeProps) {
  const { realText, redactedText, revealed } =
    useRevealSnippet('RevealSnippet.Code');
  return (
    <pre
      className={wrap ? `${styles.code} ${styles.wrap}` : styles.code}
      data-testid="reveal-snippet-code"
    >
      {revealed ? realText : redactedText}
    </pre>
  );
}

interface InputProps {
  'aria-label'?: string;
  /** Reveal-toggle aria label. Default "Reveal value". */
  revealLabel?: string;
  /** Copy aria label / tooltip. Default "Copy". */
  copyLabel?: string;
  'data-testid'?: string;
}

/**
 * Read-only field for a secret value (e.g. an API key), with the reveal
 * eye and copy icon inline in the right section. Self-contained: renders
 * its own reveal + copy, so it needs no sibling `Reveal` / `Copy`.
 */
function Input({
  'aria-label': ariaLabel,
  revealLabel = 'Reveal value',
  copyLabel = 'Copy',
  'data-testid': dataTestId,
}: InputProps) {
  const { realText, redactedText, revealed, toggle } = useRevealSnippet(
    'RevealSnippet.Input',
  );

  return (
    <TextInput
      readOnly
      value={revealed ? realText : redactedText}
      aria-label={ariaLabel}
      data-testid={dataTestId}
      styles={{
        input: { fontFamily: 'var(--mantine-font-family-monospace)' },
      }}
      rightSectionWidth={toggle ? 64 : 36}
      rightSection={
        <Group gap={2} wrap="nowrap">
          {toggle ? (
            <Tooltip label={revealed ? 'Hide' : revealLabel}>
              <ActionIcon
                onClick={toggle}
                variant="subtle"
                color="gray"
                aria-label={revealed ? 'Hide value' : revealLabel}
              >
                {revealed ? <IconEyeOff size={16} /> : <IconEye size={16} />}
              </ActionIcon>
            </Tooltip>
          ) : null}
          <CopyButton value={realText} timeout={2000}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Copied' : copyLabel}>
                <ActionIcon
                  onClick={copy}
                  variant="subtle"
                  color="gray"
                  aria-label={copyLabel}
                >
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Group>
      }
    />
  );
}

interface CopyProps {
  /** Tooltip / aria label. Default "Copy". */
  label?: string;
  /** Render a labelled button instead of an icon-only action. */
  variant?: 'icon' | 'button';
}

/** Copies the real value regardless of reveal state. */
function Copy({ label = 'Copy', variant = 'icon' }: CopyProps) {
  const { realText } = useRevealSnippet('RevealSnippet.Copy');
  return (
    <CopyButton value={realText} timeout={2000}>
      {({ copied, copy }) =>
        variant === 'button' ? (
          <Button
            onClick={copy}
            variant="subtle"
            color="gray"
            c="inherit"
            size="xs"
            className={styles.reveal}
            leftSection={
              copied ? <IconCheck size={14} /> : <IconCopy size={14} />
            }
          >
            {copied ? 'Copied' : label}
          </Button>
        ) : (
          <Tooltip label={copied ? 'Copied' : label}>
            <ActionIcon
              onClick={copy}
              variant="subtle"
              color="gray"
              aria-label={label}
            >
              {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            </ActionIcon>
          </Tooltip>
        )
      }
    </CopyButton>
  );
}

RevealSnippet.Reveal = Reveal;
RevealSnippet.Code = Code;
RevealSnippet.Input = Input;
RevealSnippet.Copy = Copy;
