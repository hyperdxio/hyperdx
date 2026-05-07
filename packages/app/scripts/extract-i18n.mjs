import { existsSync, promises as fs } from 'fs';
import path from 'path';
import ts from 'typescript';

import nextI18NextConfig from '../next-i18next.config.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const sourceDirs = ['src', 'pages'].map(dir => path.join(appRoot, dir));
const localesRoot = path.join(appRoot, 'public', 'locales');
const namespace = nextI18NextConfig.defaultNS ?? 'common';
const locales = nextI18NextConfig.i18n.locales;
const sourceFileExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);

async function collectSourceFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async entry => {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (
          entry.name === '__tests__' ||
          entry.name === '.next' ||
          entry.name === 'coverage' ||
          entry.name === 'node_modules'
        ) {
          return [];
        }

        return collectSourceFiles(entryPath);
      }

      if (
        entry.isFile() &&
        sourceFileExtensions.has(path.extname(entry.name)) &&
        !entry.name.endsWith('.test.tsx') &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.spec.tsx') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('.stories.tsx') &&
        !entry.name.endsWith('.stories.ts')
      ) {
        return [entryPath];
      }

      return [];
    }),
  );

  return files.flat();
}

function extractInterpolationName(property) {
  if (ts.isShorthandPropertyAssignment(property)) {
    return property.name.text;
  }

  if (ts.isPropertyAssignment(property)) {
    const { name } = property;

    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
      return name.text;
    }
  }

  return null;
}

function expressionToTranslationText(expression) {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }

  if (ts.isObjectLiteralExpression(expression)) {
    const interpolationNames = expression.properties
      .map(extractInterpolationName)
      .filter(name => name !== null);

    if (interpolationNames.length > 0) {
      return interpolationNames.map(name => `{{${name}}}`).join('');
    }
  }

  return '';
}

function childrenToTranslationText(children) {
  return children
    .map(child => {
      if (ts.isJsxText(child)) {
        return child.getText().replace(/\s+/g, ' ');
      }

      if (ts.isJsxExpression(child) && child.expression) {
        return expressionToTranslationText(child.expression);
      }

      if (ts.isJsxElement(child)) {
        return childrenToTranslationText(child.children);
      }

      if (ts.isJsxSelfClosingElement(child)) {
        return '';
      }

      return '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTransElement(node) {
  return (
    ts.isJsxElement(node) &&
    ts.isIdentifier(node.openingElement.tagName) &&
    node.openingElement.tagName.text === 'Trans'
  );
}

function getStringAttribute(openingElement, attributeName) {
  const attribute = openingElement.attributes.properties.find(
    property =>
      ts.isJsxAttribute(property) &&
      property.name.text === attributeName &&
      property.initializer !== undefined,
  );

  if (!attribute || !ts.isJsxAttribute(attribute)) {
    return null;
  }

  const { initializer } = attribute;

  if (ts.isStringLiteral(initializer)) {
    return initializer.text;
  }

  if (
    ts.isJsxExpression(initializer) &&
    initializer.expression &&
    ts.isStringLiteral(initializer.expression)
  ) {
    return initializer.expression.text;
  }

  return null;
}

function extractKeysFromSource(filePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const keys = new Set();

  function visit(node) {
    if (isTransElement(node)) {
      const key =
        getStringAttribute(node.openingElement, 'i18nKey') ??
        getStringAttribute(node.openingElement, 'defaults') ??
        childrenToTranslationText(node.children);

      if (key) {
        keys.add(key);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return keys;
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

function buildLocaleJson(existingTranslations, extractedKeys, locale) {
  const mergedTranslations = {};

  for (const key of extractedKeys) {
    mergedTranslations[key] =
      existingTranslations[key] ?? (locale === 'en' ? key : '');
  }

  return Object.fromEntries(
    Object.entries(mergedTranslations).sort(([a], [b]) => a.localeCompare(b)),
  );
}

async function main() {
  const sourceFiles = (
    await Promise.all(sourceDirs.map(collectSourceFiles))
  ).flat();
  const extractedKeys = new Set();

  for (const filePath of sourceFiles) {
    const sourceText = await fs.readFile(filePath, 'utf8');
    const fileKeys = extractKeysFromSource(filePath, sourceText);

    for (const key of fileKeys) {
      extractedKeys.add(key);
    }
  }

  const sortedKeys = [...extractedKeys].sort((a, b) => a.localeCompare(b));

  await Promise.all(
    locales.map(async locale => {
      await fs.mkdir(path.join(localesRoot, locale), { recursive: true });

      const localePath = path.join(localesRoot, locale, `${namespace}.json`);
      const existingTranslations = await readJsonFile(localePath);
      const localeJson = buildLocaleJson(
        existingTranslations,
        sortedKeys,
        locale,
      );

      await fs.writeFile(
        localePath,
        `${JSON.stringify(localeJson, null, 2)}\n`,
      );
    }),
  );

  console.log(
    `Extracted ${sortedKeys.length} ${namespace} keys into ${locales.length} locales.`,
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
