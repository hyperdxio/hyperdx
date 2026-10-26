import {
  getWebhookTemplateError,
  type WebhookTemplateError,
} from '@hyperdx/common-utils/dist/core/handlebarsEnv';
import { WebhookService } from '@hyperdx/common-utils/dist/types';
import Handlebars from 'handlebars';

export class WebhookBodyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookBodyValidationError';
  }
}

/**
 * Helpers alert delivery registers (`createHandlebarsWithHelpers` in
 * tasks/checkAlerts/transports/generic.ts). Listed here rather than imported,
 * since generic.ts imports validators.ts, which imports this module. A unit
 * test pins the two together.
 */
export const WEBHOOK_BODY_HELPERS = new Set([
  'eq',
  'if',
  'unless',
  'each',
  'with',
  'lookup',
  'log',
]);

type HelperCall =
  | hbs.AST.MustacheStatement
  | hbs.AST.BlockStatement
  | hbs.AST.SubExpression;

const toError = (
  message: string,
  node: hbs.AST.Node,
): WebhookTemplateError => ({
  message,
  line: node.loc.start.line,
  column: node.loc.start.column + 1,
});

const nameOf = (node: hbs.AST.Expression): string =>
  'original' in node ? String(node.original) : node.type;

/**
 * Finds the first construct that compiles but throws on every delivery: a
 * call with arguments to a helper delivery doesn't register, a partial the
 * template doesn't define inline, or a decorator other than `inline`.
 * Handlebars only throws for these when they render, so a typo inside an
 * untaken branch would pass a test render; walk the AST instead.
 */
function findUndeliverableConstruct(
  template: string,
): WebhookTemplateError | null {
  let found: WebhookTemplateError | null = null;
  const inlinePartials = new Set<string>();
  const partialRefs: hbs.AST.PartialStatement[] = [];

  const checkHelperCall = (node: HelperCall) => {
    if (found != null || node.params.length === 0) return;
    const { path } = node;
    if (
      path.type === 'PathExpression' &&
      WEBHOOK_BODY_HELPERS.has(nameOf(path))
    )
      return;
    found = toError(`Unknown helper "${nameOf(path)}"`, path);
  };

  class Visitor extends Handlebars.Visitor {
    MustacheStatement(node: hbs.AST.MustacheStatement) {
      checkHelperCall(node);
      super.MustacheStatement(node);
    }
    BlockStatement(node: hbs.AST.BlockStatement) {
      checkHelperCall(node);
      super.BlockStatement(node);
    }
    SubExpression(node: hbs.AST.SubExpression) {
      checkHelperCall(node);
      super.SubExpression(node);
    }
    PartialStatement(node: hbs.AST.PartialStatement) {
      partialRefs.push(node);
      super.PartialStatement(node);
    }
    Decorator(node: hbs.AST.Decorator) {
      found ??= toError(`Unknown decorator "${nameOf(node.path)}"`, node.path);
      super.Decorator(node);
    }
    DecoratorBlock(node: hbs.AST.DecoratorBlock) {
      const [partial] = node.params;
      if (nameOf(node.path) === 'inline' && partial?.type === 'StringLiteral') {
        inlinePartials.add(nameOf(partial));
      } else {
        found ??= toError(
          `Unknown decorator "${nameOf(node.path)}"`,
          node.path,
        );
      }
      super.DecoratorBlock(node);
    }
  }
  new Visitor().accept(Handlebars.parse(template));

  // A partial block (`{{#> name}}…{{/name}}`) renders its fallback, so only a
  // plain partial with no inline definition fails.
  const unknownPartial = partialRefs.find(ref => {
    const name = nameOf(ref.name);
    // `@`-prefixed partials, like `@partial-block`, come from Handlebars.
    return !name.startsWith('@') && !inlinePartials.has(name);
  });
  return (
    found ??
    (unknownPartial == null
      ? null
      : toError(
          `Unknown partial "${nameOf(unknownPartial.name)}"`,
          unknownPartial.name,
        ))
  );
}

/**
 * Rejects a body template that would fail on every alert delivery: one
 * Handlebars cannot compile, or one that uses a helper, partial, or decorator
 * delivery doesn't provide. Slack never renders the body.
 */
export function validateWebhookBodyTemplate({
  service,
  body,
}: {
  service: WebhookService;
  body?: string;
}) {
  if (service === WebhookService.Slack) return;
  const error =
    getWebhookTemplateError(body) ??
    (body?.trim() ? findUndeliverableConstruct(body) : null);
  if (error == null) return;
  const location =
    error.line == null
      ? ''
      : ` (line ${error.line}${error.column == null ? '' : `, column ${error.column}`})`;
  throw new WebhookBodyValidationError(
    `Invalid webhook body template${location}: ${error.message}`,
  );
}
