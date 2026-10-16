import { linter } from '@codemirror/lint';
import {
  isPromqlMacroName,
  PROMQL_MACRO_NAMES,
} from '@hyperdx/common-utils/dist/core/promql';
import {
  scanTemplateTokens,
  VARIABLE_MACRO_NAMES,
} from '@hyperdx/common-utils/dist/variables';
import {
  LanguageType,
  PromQLExtension,
  promQLLanguage,
} from '@prometheus-io/codemirror-promql';

type TemplateOptions = { enableMacros: boolean };

type TemplateRange = { from: number; to: number; isMacro: boolean };

/**
 * The spans of an expression that are templates rather than PromQL: macros
 * (when enabled) and variable references outside string literals. A macro's
 * arguments are masked with it: substitution reports a bad argument count.
 */
export function findMaskedTemplateRanges(
  expression: string,
  { enableMacros }: TemplateOptions,
): TemplateRange[] {
  const ranges: TemplateRange[] = [];
  let offset = 0;
  const tokens = scanTemplateTokens(
    expression,
    enableMacros
      ? [...VARIABLE_MACRO_NAMES, ...PROMQL_MACRO_NAMES]
      : VARIABLE_MACRO_NAMES,
    { onMalformed: 'skip' },
  );
  for (const token of tokens) {
    if (token.kind === 'text') {
      offset += token.text.length;
      continue;
    }
    const isMacro = token.kind === 'macro';
    const isMaskable =
      !token.inStringLiteral && (!isMacro || isPromqlMacroName(token.name));
    if (isMaskable) {
      ranges.push({ from: offset, to: offset + token.raw.length, isMacro });
    }
    offset += token.raw.length;
  }
  return ranges;
}

const basePromqlLanguage = promQLLanguage(LanguageType.PromQL);

/**
 * The expression with each template swapped for same-length filler, so the
 * parse tree's offsets still line up with the original text. Macros are
 * durations, so they become digits. Variables usually stand for names, as in
 * `sum by (${labels:csv})`, so they become letters; one used as a number or
 * duration is flagged.
 */
export function maskPromqlTemplates(
  expression: string,
  options: TemplateOptions,
): string {
  let masked = '';
  let offset = 0;
  for (const { from, to, isMacro } of findMaskedTemplateRanges(
    expression,
    options,
  )) {
    masked +=
      expression.slice(offset, from) + (isMacro ? '1' : 'a').repeat(to - from);
    offset = to;
  }
  return masked + expression.slice(offset);
}

/**
 * The PromQL language, parsing the masked expression so highlighting, bracket
 * matching, completion and linting all see a valid tree around templates.
 */
export const templateMaskedPromqlLanguage = (options: TemplateOptions) =>
  basePromqlLanguage.configure({
    wrap: (_inner, input, _fragments, ranges) => {
      const masked = maskPromqlTemplates(input.read(0, input.length), options);
      // No fragments: a mask can change outside the edited range (e.g. typing
      // a quote), so reusing the old tree could leave stale nodes.
      return basePromqlLanguage.parser.createParse(
        {
          length: masked.length,
          chunk: from => masked.slice(from),
          lineChunks: false,
          read: (from, to) => masked.slice(from, to),
        },
        [],
        ranges,
      );
    },
  });

const MASKED_LANGUAGES = {
  macros: templateMaskedPromqlLanguage({ enableMacros: true }),
  noMacros: templateMaskedPromqlLanguage({ enableMacros: false }),
};

/**
 * Stands in for the `PromQLExtension.asExtension()` codemirror extension, providing
 * linting and syntax highlighting that is variable- and macro-aware.
 */
export function promqlTemplateExtension(
  promqlExtension: PromQLExtension,
  { enableMacros }: TemplateOptions,
) {
  const lintStrategy = promqlExtension.getLinter();
  return [
    enableMacros ? MASKED_LANGUAGES.macros : MASKED_LANGUAGES.noMacros,
    linter(lintStrategy.promQL()),
  ];
}
