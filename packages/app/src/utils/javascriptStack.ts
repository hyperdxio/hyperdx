import type { StacktraceFrame } from '@/types';
import { defaultStackParser } from '@/utils/sentryStackParser';
import type { Attributes } from '@/utils/spanAttributeReaders';

const JAVASCRIPT_SDK_LANGUAGES = new Set(['webjs', 'nodejs']);

// Parsing runs during render on client-controlled text, and a crafted 1 KB line
// still costs the line parsers ~1.5 ms, so longer stacks are shown as text.
const MAX_PARSED_STACK_LENGTH = 64 * 1024;

const CAUSED_BY_REGEX = /^\s*Caused by: /;
const V8_FRAME_REGEX = /^\s*at /;
const ERROR_TITLE_REGEX = /^([^\s:]+)(?:: ([\s\S]*))?$/;

// Library, runtime and bundler frames. The old browser SDK deleted Next.js
// framework chunks outright; marking them keeps the frames, and the panel
// opens on the app's newest in-app frame instead of them.
const NOT_IN_APP_FILENAME_PATTERNS = [
  /node_modules/,
  /^(node:|internal\/)/,
  /\/framework-[0-9a-f]+\.js/,
  /\/_next\/static\/chunks\/(main|main-app|webpack|polyfills)(-[0-9a-f]+)?\.js/,
  /(^|\/)webpack\/(runtime|bootstrap)/,
  /\/(webpack-runtime|runtime[~-]main)[^/]*\.js/,
];

type JavaScriptCause = {
  type: string;
  value: string;
  frames: StacktraceFrame[];
};

export type ParsedJavaScriptException = {
  frames: StacktraceFrame[];
  causes: JavaScriptCause[];
};

export function isJavaScriptRuntime(resourceAttributes: Attributes): boolean {
  const language = resourceAttributes['telemetry.sdk.language'];
  return typeof language === 'string' && JAVASCRIPT_SDK_LANGUAGES.has(language);
}

// Frames without a line number are native, anonymous or `data:` URI frames:
// never app code, and nothing a source map can resolve.
function isInApp({ filename, lineno }: StacktraceFrame): boolean {
  return (
    lineno !== undefined &&
    !NOT_IN_APP_FILENAME_PATTERNS.some(pattern => pattern.test(filename))
  );
}

// The `Name: message` header is every line before the first frame, and a
// multi-line message can contain URL lines the Gecko parser would read as
// frames. V8 frames start with `at `. Firefox and Safari frames always contain
// `@` (`fn@url:1:2`, `@url:1:2`, `fn@[native code]`); their main stack has no
// header, but `Caused by:` sections and frameless `toString()` text do.
function getHeaderLength(lines: string[]): number {
  const v8FrameIndex = lines.findIndex(line => V8_FRAME_REGEX.test(line));
  if (v8FrameIndex !== -1) {
    return v8FrameIndex;
  }
  const geckoFrameIndex = lines.findIndex(line => line.includes('@'));
  return geckoFrameIndex === -1 ? lines.length : geckoFrameIndex;
}

function parseSection(lines: string[]) {
  const headerLength = getHeaderLength(lines);
  const frames = defaultStackParser(lines.join('\n'), headerLength).map(
    frame => ({ ...frame, in_app: isInApp(frame) }),
  );
  return { header: lines.slice(0, headerLength), frames };
}

// The title is the `Caused by:` line joined with the header lines below it, so
// a message that starts with a line break (`Error: \nDetails`) would keep it
// and open with a blank line. Only the start is trimmed before matching: a
// whitespace-only message leaves `Error: `, whose space the regex needs.
function parseCauseTitle(
  title: string,
): Pick<JavaScriptCause, 'type' | 'value'> {
  const text = title.trimStart();
  const match = ERROR_TITLE_REGEX.exec(text);
  return match
    ? { type: match[1], value: (match[2] ?? '').trim() }
    : { type: '', value: text.trimEnd() };
}

/**
 * Parses an `Error.stack` string from a JavaScript SDK, which appends each
 * error in the `cause` chain as a Java-style `Caused by: Name: message`
 * section. Frames are oldest first. Returns undefined when no section has a
 * frame or the text is too long to parse, so the caller can show it instead.
 */
export function parseJavaScriptException(
  stack: string,
): ParsedJavaScriptException | undefined {
  if (stack.length > MAX_PARSED_STACK_LENGTH) {
    return undefined;
  }
  const sections: { title?: string; lines: string[] }[] = [{ lines: [] }];
  for (const line of stack.split('\n')) {
    if (CAUSED_BY_REGEX.test(line)) {
      sections.push({ title: line.replace(CAUSED_BY_REGEX, ''), lines: [] });
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }

  const [main, ...causes] = sections.map(({ title, lines }) => ({
    title,
    ...parseSection(lines),
  }));
  if (![main, ...causes].some(section => section.frames.length > 0)) {
    return undefined;
  }

  return {
    frames: main.frames,
    causes: causes.map(({ title, header, frames }) => ({
      ...parseCauseTitle([title, ...header].join('\n')),
      frames,
    })),
  };
}
