// Parses JavaScript `Error.stack` text into frames: Sentry's Chrome (V8) and
// Gecko (Firefox, Safari) line parsers and `createStackParser`, ported from
// sentry-javascript 11.10.0:
// https://github.com/getsentry/sentry-javascript/blob/11.10.0/packages/browser/src/stack-parsers.ts
// https://github.com/getsentry/sentry-javascript/blob/11.10.0/packages/core/src/utils/stacktrace.ts
//
// Changes from upstream:
// - Typed against HyperDX's `StacktraceFrame`, without upstream's `exec()`
//   result casts.
// - Only the Chrome and Gecko line parsers (upstream's
//   `defaultStackLineParsers`); WinJS and Opera are dropped.
// - `createStackParser` drops the unused `framesToPop` parameter.
// - The final reverse no longer strips `sentryWrapped` and
//   `captureException`/`captureMessage` frames. Those target Sentry's own SDK
//   and would drop an app's own `captureException` frame.
// - The `data:` URI frame sets `in_app` like every other frame.
// - `createStackParser` skips lines with more than 32 parentheses.
//
// MIT License
//
// Copyright (c) 2019 Functional Software, Inc. dba Sentry
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of
// this software and associated documentation files (the "Software"), to deal in
// the Software without restriction, including without limitation the rights to
// use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
// of the Software, and to permit persons to whom the Software is furnished to do
// so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// The line parsers were originally forked from https://github.com/csnover/TraceKit,
// and were largely re-written as part of raven-js. Upstream's TraceKit notice:
//
// Copyright (c) 2013 Onur Can Cakmak onur.cakmak@gmail.com and all TraceKit contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this
// software and associated documentation files(the 'Software'), to deal in the Software
// without restriction, including without limitation the rights to use, copy, modify,
// merge, publish, distribute, sublicense, and / or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following
// conditions:
//
// The above copyright notice and this permission notice shall be included in all copies
// or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
// INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
// PARTICULAR PURPOSE AND NONINFRINGEMENT.IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
// HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
// CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
// OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import type { StacktraceFrame } from '@/types';

type StackLineParserFn = (line: string) => StacktraceFrame | undefined;
type StackLineParser = [priority: number, parse: StackLineParserFn];

const STACKTRACE_FRAME_LIMIT = 50;
const MAX_LINE_PARENTHESES = 32;
export const UNKNOWN_FUNCTION = '?';
// Used to sanitize webpack (error: *) wrapped stack errors
const WEBPACK_ERROR_REGEXP = /\(error: (.*)\)/;

const CHROME_PRIORITY = 30;
const GECKO_PRIORITY = 50;

function createFrame(
  filename: string,
  func: string,
  lineno?: number,
  colno?: number,
): StacktraceFrame {
  const frame: StacktraceFrame = {
    filename,
    function: func === '<anonymous>' ? UNKNOWN_FUNCTION : func,
    in_app: true, // All browser frames are considered in_app
  };

  if (lineno !== undefined) {
    frame.lineno = lineno;
  }

  if (colno !== undefined) {
    frame.colno = colno;
  }

  return frame;
}

// This regex matches frames that have no function name (ie. are at the top level of a module).
// For example "at http://localhost:5000//script.js:1:126"
// Frames _with_ function names usually look as follows: "at commitLayoutEffects (react-dom.development.js:23426:1)"
const chromeRegexNoFnName = /^\s*at (\S+?)(?::(\d+))(?::(\d+))\s*$/i;

// This regex matches all the frames that have a function name.
const chromeRegex =
  /^\s*at (?:(.+?\)(?: \[.+\])?|.*?) ?\((?:address at )?)?(?:async )?((?:<anonymous>|[-a-z]+:|.*bundle|\/)?.*?)(?::(\d+))?(?::(\d+))?\)?\s*$/i;

const chromeEvalRegex = /\((\S*)(?::(\d+))(?::(\d+))\)/;

// Matches stack frames with data URIs instead of filename so we can still get the function name
// Example: "at dynamicFn (data:application/javascript,export function dynamicFn() {..."
const chromeDataUriRegex = /at (.+?) ?\(data:(.+?),/;

// Chromium based browsers: Chrome, Brave, new Opera, new Edge
const chromeStackParserFn: StackLineParserFn = line => {
  const dataUriMatch = line.match(chromeDataUriRegex);
  if (dataUriMatch) {
    return {
      filename: `<data:${dataUriMatch[2]}>`,
      function: dataUriMatch[1],
      in_app: true,
    };
  }

  // If the stack line has no function name, we need to parse it differently
  const noFnParts = chromeRegexNoFnName.exec(line);

  if (noFnParts) {
    const [, filename, line, col] = noFnParts;
    return createFrame(filename, UNKNOWN_FUNCTION, +line, +col);
  }

  const parts = chromeRegex.exec(line);

  if (parts) {
    const isEval = parts[2]?.indexOf('eval') === 0; // start of line

    if (isEval) {
      const subMatch = chromeEvalRegex.exec(parts[2]);

      if (subMatch) {
        // throw out eval line/column and use top-most line/column number
        parts[2] = subMatch[1]; // url
        parts[3] = subMatch[2]; // line
        parts[4] = subMatch[3]; // column
      }
    }

    const [func, filename] = extractSafariExtensionDetails(
      parts[1] || UNKNOWN_FUNCTION,
      parts[2],
    );

    return createFrame(
      filename,
      func,
      parts[3] ? +parts[3] : undefined,
      parts[4] ? +parts[4] : undefined,
    );
  }

  return;
};

const chromeStackLineParser: StackLineParser = [
  CHROME_PRIORITY,
  chromeStackParserFn,
];

// gecko regex: `(?:bundle|\d+\.js)`: `bundle` is for react native, `\d+\.js` also but specifically for ram bundles because it
// generates filenames without a prefix like `file://` the filenames in the stacktrace are just 42.js
// We need this specific case for now because we want no other regex to match.
const geckoREgex =
  /^\s*(.*?)(?:\((.*?)\))?(?:^|@)?((?:[-a-z]+)?:\/.*?|\[native code\]|[^@]*(?:bundle|\d+\.js)|\/[\w\-. /=]+)(?::(\d+))?(?::(\d+))?\s*$/i;
const geckoEvalRegex = /(\S+) line (\d+)(?: > eval line \d+)* > eval/i;

const gecko: StackLineParserFn = line => {
  const parts = geckoREgex.exec(line);

  if (parts) {
    const isEval = parts[3] && parts[3].indexOf(' > eval') > -1;
    if (isEval) {
      const subMatch = geckoEvalRegex.exec(parts[3]);

      if (subMatch) {
        // throw out eval line/column and use top-most line number
        parts[1] = parts[1] || 'eval';
        parts[3] = subMatch[1];
        parts[4] = subMatch[2];
        parts[5] = ''; // no column when eval
      }
    }

    let filename = parts[3];
    let func = parts[1] || UNKNOWN_FUNCTION;
    [func, filename] = extractSafariExtensionDetails(func, filename);

    return createFrame(
      filename,
      func,
      parts[4] ? +parts[4] : undefined,
      parts[5] ? +parts[5] : undefined,
    );
  }

  return;
};

const geckoStackLineParser: StackLineParser = [GECKO_PRIORITY, gecko];

/**
 * Safari web extensions, starting version unknown, can produce "frames-only" stacktraces.
 * What it means, is that instead of format like:
 *
 * Error: wat
 *   at function@url:row:col
 *   at function@url:row:col
 *   at function@url:row:col
 *
 * it produces something like:
 *
 *   function@url:row:col
 *   function@url:row:col
 *   function@url:row:col
 *
 * Because of that, it won't be captured by `chrome` RegExp and will fall into `Gecko` branch.
 * This function is extracted so that we can use it in both places without duplicating the logic.
 * Unfortunately "just" changing RegExp is too complicated now and making it pass all tests
 * and fix this case seems like an impossible, or at least way too time-consuming task.
 */
const extractSafariExtensionDetails = (
  func: string,
  filename: string,
): [string, string] => {
  const isSafariExtension = func.indexOf('safari-extension') !== -1;
  const isSafariWebExtension = func.indexOf('safari-web-extension') !== -1;

  return isSafariExtension || isSafariWebExtension
    ? [
        func.indexOf('@') !== -1 ? func.split('@')[0] : UNKNOWN_FUNCTION,
        isSafariExtension
          ? `safari-extension:${filename}`
          : `safari-web-extension:${filename}`,
      ]
    : [func, filename];
};

function createStackParser(...parsers: StackLineParser[]) {
  const sortedParsers = parsers.sort((a, b) => a[0] - b[0]).map(p => p[1]);

  return (stack: string, skipFirstLines: number = 0): StacktraceFrame[] => {
    const frames: StacktraceFrame[] = [];
    const lines = stack.split('\n');

    for (let i = skipFirstLines; i < lines.length; i++) {
      let line = lines[i];
      // Truncate lines over 1kb because many of the regular expressions use
      // backtracking which results in run time that increases exponentially
      // with input size. Huge strings can result in hangs/Denial of Service:
      // https://github.com/getsentry/sentry-javascript/issues/2286
      if (line.length > 1024) {
        line = line.slice(0, 1024);
      }

      // Upstream parses the page's own `Error.stack`; this parses stored text
      // anyone can send. The Gecko regex backtracks in proportion to the
      // number of `(` times `)` in a line, which the 1 KB cut doesn't bound
      // (~90 ms for one line). Real frames have a handful.
      if (line.replace(/[^()]/g, '').length > MAX_LINE_PARENTHESES) {
        continue;
      }

      // https://github.com/getsentry/sentry-javascript/issues/5459
      // Remove webpack (error: *) wrappers
      const cleanedLine = WEBPACK_ERROR_REGEXP.test(line)
        ? line.replace(WEBPACK_ERROR_REGEXP, '$1')
        : line;

      // https://github.com/getsentry/sentry-javascript/issues/7813
      // Skip Error: lines
      // Using includes() instead of a regex to avoid O(n²) backtracking on long lines
      // https://github.com/getsentry/sentry-javascript/issues/20052
      if (cleanedLine.includes('Error: ')) {
        continue;
      }

      for (const parser of sortedParsers) {
        const frame = parser(cleanedLine);

        if (frame) {
          frames.push(frame);
          break;
        }
      }

      if (frames.length >= STACKTRACE_FRAME_LIMIT) {
        break;
      }
    }

    return reverseFrames(frames);
  };
}

/**
 * Enforces a limit of max number of frames. Assumes stack input is ordered
 * from top to bottom and returns the reverse representation so call site of
 * the function that caused the crash is the last frame in the array.
 */
function reverseFrames(stack: ReadonlyArray<StacktraceFrame>) {
  if (!stack.length) {
    return [];
  }

  const localStack = Array.from(stack).reverse();
  const lastFrame = localStack[localStack.length - 1];

  return localStack.slice(0, STACKTRACE_FRAME_LIMIT).map(frame => ({
    ...frame,
    filename: frame.filename || lastFrame.filename,
    function: frame.function || UNKNOWN_FUNCTION,
  }));
}

/** Frames oldest first, every frame `in_app: true`, at most 50. */
export const defaultStackParser = createStackParser(
  chromeStackLineParser,
  geckoStackLineParser,
);
