import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const userFacingAttributes = new Set(
  'aria-label,ariaLabel,description,label,placeholder,title,tooltip,alt'.split(','),
);
const userFacingProperties = new Set(
  'description,label,message,placeholder,title'.split(','),
);
const containsLatin = /[A-Za-z]/;

const toPackageRelative = filePath =>
  path.relative(packageRoot, filePath).split(path.sep).join('/');

const isExcluded = filePath => {
  const relativePath = toPackageRelative(filePath);
  const segments = relativePath.split('/');
  const basename = path.basename(relativePath);

  return (
    relativePath === 'src/i18n' ||
    relativePath.startsWith('src/i18n/') ||
    relativePath === 'src/mocks' ||
    relativePath.startsWith('src/mocks/') ||
    relativePath === 'src/__mocks__' ||
    relativePath.startsWith('src/__mocks__/') ||
    relativePath === 'pages/api' ||
    relativePath.startsWith('pages/api/') ||
    segments.includes('__tests__') ||
    /\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(basename)
  );
};

const collectSourceFiles = directory => {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectSourceFiles(entryPath);
    }

    return /\.tsx?$/.test(entry.name) && !isExcluded(entryPath)
      ? [entryPath]
      : [];
  });
};

const normalizeText = value => value.replace(/\s+/g, ' ').trim();

const textWithoutJsxEntities = value =>
  value.replace(/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);/gi, '');

const isUrl = value =>
  /^(?:(?:https?|ftp|wss?):\/\/|file:\/\/|(?:mailto|tel):|\/\/|\/|\.{1,2}\/|#)/i.test(
    value,
  );

const staticText = (node, text) => ({
  candidates: [{ node, text }],
  isStatic: true,
});

const dynamicText = candidates => ({ candidates, isStatic: false });

const getStaticTexts = node => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return staticText(node, node.text);
  }

  if (ts.isTemplateExpression(node)) {
    const candidates = node.head.text
      ? [{ node: node.head, text: node.head.text }]
      : [];

    for (const span of node.templateSpans) {
      candidates.push(...getStaticTexts(span.expression).candidates);

      if (span.literal.text) {
        candidates.push({ node: span.literal, text: span.literal.text });
      }
    }

    return dynamicText(candidates);
  }

  if (ts.isConditionalExpression(node)) {
    const whenTrue = getStaticTexts(node.whenTrue);
    const whenFalse = getStaticTexts(node.whenFalse);

    return dynamicText([...whenTrue.candidates, ...whenFalse.candidates]);
  }

  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = getStaticTexts(node.left);
    const right = getStaticTexts(node.right);

    if (left.isStatic && right.isStatic) {
      return staticText(
        node,
        `${left.candidates[0].text}${right.candidates[0].text}`,
      );
    }

    return dynamicText([...left.candidates, ...right.candidates]);
  }

  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return getStaticTexts(node.expression);
  }

  return dynamicText([]);
};

const propertyName = name => {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }

  return undefined;
};

const tagName = tag => tag.getText().split('.').at(-1);

const isWithinTrans = node => {
  let ancestor = node.parent;

  while (ancestor != null) {
    if (
      ts.isJsxElement(ancestor) &&
      tagName(ancestor.openingElement.tagName) === 'Trans'
    ) {
      return true;
    }

    ancestor = ancestor.parent;
  }

  return false;
};

const isJsxChildExpression = node =>
  ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent);

const createDiagnostic = (sourceFile, node, text, context) => {
  const position = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );

  return {
    file: toPackageRelative(sourceFile.fileName),
    line: position.line + 1,
    column: position.character + 1,
    text: normalizeText(text),
    context,
  };
};

const scanFile = filePath => {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const diagnostics = [];

  const addIfUserFacing = (node, text, context) => {
    const normalized = normalizeText(text);

    if (
      normalized &&
      !isUrl(normalized) &&
      containsLatin.test(textWithoutJsxEntities(normalized))
    ) {
      diagnostics.push(createDiagnostic(sourceFile, node, normalized, context));
    }
  };

  const addStaticTexts = (result, context) => {
    for (const candidate of result.candidates) {
      addIfUserFacing(candidate.node, candidate.text, context);
    }
  };

  const visit = node => {
    if (ts.isJsxText(node) && !isWithinTrans(node)) {
      addIfUserFacing(node, node.getText(sourceFile), 'JSX text');
    }

    if (
      ts.isJsxExpression(node) &&
      isJsxChildExpression(node) &&
      !isWithinTrans(node) &&
      node.expression != null
    ) {
      addStaticTexts(getStaticTexts(node.expression), 'JSX child expression');
    }

    if (ts.isJsxAttribute(node) && userFacingAttributes.has(node.name.text)) {
      const initializer = node.initializer;

      if (initializer != null) {
        const expression = ts.isJsxExpression(initializer)
          ? initializer.expression
          : initializer;

        if (expression != null) {
          addStaticTexts(
            getStaticTexts(expression),
            `${node.name.text} attribute`,
          );
        }
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);

      if (name != null && userFacingProperties.has(name)) {
        addStaticTexts(getStaticTexts(node.initializer), `${name} property`);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return diagnostics;
};

const readAllowlist = (
  allowlistPath = path.join(packageRoot, 'i18n-audit-allowlist.json'),
) => {
  let parsed;

  try {
    parsed = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Unable to read ${path.basename(allowlistPath)}: ${error.message}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error('i18n-audit-allowlist.json must contain an array');
  }

  const entries = parsed.map((entry, index) => {
    if (
      entry == null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      Object.keys(entry).length !== 3 ||
      !Object.hasOwn(entry, 'file') ||
      !Object.hasOwn(entry, 'text') ||
      !Object.hasOwn(entry, 'reason') ||
      typeof entry.file !== 'string' ||
      !entry.file.trim() ||
      typeof entry.text !== 'string' ||
      !entry.text.trim() ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim()
    ) {
      throw new Error(
        `Allowlist entry ${index} must be exactly { file, text, reason } with nonblank strings`,
      );
    }

    return entry;
  });
  const keys = new Set();

  for (const entry of entries) {
    const key = `${entry.file}\u0000${entry.text}`;

    if (keys.has(key)) {
      throw new Error(
        `Duplicate allowlist entry for ${entry.file}: ${entry.text}`,
      );
    }

    keys.add(key);
  }

  return entries;
};

const compareStrings = (left, right) =>
  left === right ? 0 : left < right ? -1 : 1;

const sortDiagnostics = diagnostics =>
  diagnostics.sort(
    (left, right) =>
      compareStrings(left.file, right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      compareStrings(left.text, right.text) ||
      compareStrings(left.context, right.context),
  );

const formatDiagnostic = diagnostic =>
  `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.context}: ${JSON.stringify(diagnostic.text)}`;

const usage =
  'Usage: node scripts/check-i18n.mjs [--fixture valid|invalid|invalid-ts] [--allowlist path]';

const parseArguments = args => {
  const options = { allowlistPath: undefined, fixtureName: undefined };

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];

    if ((option === '--fixture' || option === '--allowlist') && value != null) {
      options[option === '--fixture' ? 'fixtureName' : 'allowlistPath'] = value;
      index += 1;
      continue;
    }

    return undefined;
  }

  return options;
};

const options = parseArguments(process.argv.slice(2));
const fixtureFiles = {
  deterministic: 'deterministic',
  'deterministic-reverse': [
    'deterministic/z-first.tsx',
    'deterministic/a-second.tsx',
  ],
  valid: 'valid.tsx',
  invalid: 'invalid.tsx',
  'invalid-ts': 'invalid-ts.ts',
};

if (
  options == null ||
  (options.fixtureName != null &&
    !Object.hasOwn(fixtureFiles, options.fixtureName))
) {
  console.error(usage);
  process.exitCode = 2;
} else {
  try {
    const fixturePaths = options.fixtureName
      ? (Array.isArray(fixtureFiles[options.fixtureName])
          ? fixtureFiles[options.fixtureName]
          : [fixtureFiles[options.fixtureName]]
        ).map(file =>
          path.join(packageRoot, 'scripts', '__fixtures__', 'i18n-audit', file),
        )
      : [];
    const files =
      fixturePaths.length > 0
        ? fixturePaths.flatMap(fixturePath =>
            path.extname(fixturePath)
              ? [fixturePath]
              : collectSourceFiles(fixturePath),
          )
        : [
            ...collectSourceFiles(path.join(packageRoot, 'src')),
            ...collectSourceFiles(path.join(packageRoot, 'pages')),
          ];
    const diagnostics = sortDiagnostics(files.flatMap(scanFile));
    const allowlist = options.allowlistPath
      ? readAllowlist(options.allowlistPath)
      : options.fixtureName
        ? []
        : readAllowlist();
    const allowlistKeys = new Set(
      allowlist.map(entry => `${entry.file}\u0000${entry.text}`),
    );
    const usedAllowlistKeys = new Set();
    const unallowlisted = diagnostics.filter(diagnostic => {
      const key = `${diagnostic.file}\u0000${diagnostic.text}`;

      if (!allowlistKeys.has(key)) {
        return true;
      }

      usedAllowlistKeys.add(key);
      return false;
    });
    const staleEntries = allowlist.filter(
      entry => !usedAllowlistKeys.has(`${entry.file}\u0000${entry.text}`),
    );

    if (unallowlisted.length > 0) {
      console.error(
        `i18n audit found ${unallowlisted.length} hardcoded string(s):`,
      );
      for (const diagnostic of unallowlisted) {
        console.error(formatDiagnostic(diagnostic));
      }
    }

    if (staleEntries.length > 0) {
      console.error('i18n audit has unused allowlist entry/entries:');
      for (const entry of staleEntries) {
        console.error(`${entry.file}: ${JSON.stringify(entry.text)}`);
      }
    }

    if (unallowlisted.length > 0 || staleEntries.length > 0) {
      process.exitCode = 1;
    } else {
      console.log(`i18n audit passed (${files.length} file(s) scanned)`);
    }
  } catch (error) {
    console.error(`i18n audit failed: ${error.message}`);
    process.exitCode = 2;
  }
}
