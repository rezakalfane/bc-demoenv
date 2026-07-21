import ts from "typescript";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const visibleAttributes = new Set(["aria-label", "placeholder", "title", "alt"]);
const userFacingProperties = new Set([
  "description",
  "error",
  "help",
  "label",
  "message",
  "result_message",
  "status_message",
  "title",
  "warning",
]);
const implementationValues = new Set([
  "_blank",
  "abc123def4",
  "currentColor",
  "Europe/Paris",
  "false",
  "LOCAL_DATABASE_URL=file:local.db",
  "none",
  "noreferrer",
  "page",
  "sm:col-span-2",
  "text-black/35 dark:text-white/35",
  "true",
  "vercel.json",
]);
const messages = new Map();

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (/\.tsx?$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

function decodeEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function add(value, file, line) {
  const message = decodeEntities(value).replace(/\s+/g, " ").trim();
  if (!message || !/[A-Za-z]/.test(message) || message.length < 2) return;
  if (implementationValues.has(message)) return;
  if (/^(https?:|\/|\.\/|#|[A-Z0-9_]+$)/.test(message)) return;
  if (/^[Mm]\d/.test(message) || /^[a-z]+:/.test(message)) return;
  if (/^(?:mt-|sm:|text-|border-|bg-|dark:)/.test(message)) return;
  const locations = messages.get(message) ?? [];
  locations.push(`${path.relative(root, file)}:${line}`);
  messages.set(message, locations);
}

function propertyName(node, source) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return node.getText(source);
}

function addLiteral(node, file, line) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    add(node.text, file, line);
  }
}

for (const file of await walk(path.join(root, "src"))) {
  const sourceText = await readFile(file, "utf8");
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  function visit(node) {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    if (ts.isJsxText(node)) add(node.text, file, line);
    if (ts.isJsxAttribute(node) && visibleAttributes.has(node.name.getText(source)) && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) add(node.initializer.text, file, line);
      else if (
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression &&
        ts.isStringLiteral(node.initializer.expression)
      ) add(node.initializer.expression.text, file, line);
    }
    if (ts.isStringLiteral(node) && ts.isJsxExpression(node.parent)) add(node.text, file, line);
    if (ts.isConditionalExpression(node) && ts.isJsxExpression(node.parent)) {
      if (ts.isStringLiteral(node.whenTrue)) add(node.whenTrue.text, file, line);
      if (ts.isStringLiteral(node.whenFalse)) add(node.whenFalse.text, file, line);
    }
    if (
      ts.isPropertyAssignment(node) &&
      userFacingProperties.has(propertyName(node.name, source) ?? "")
    ) {
      addLiteral(node.initializer, file, line);
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Error" &&
      node.arguments?.[0]
    ) {
      addLiteral(node.arguments[0], file, line);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
}

const english = JSON.parse(await readFile(path.join(root, "src/i18n/app_en.json"), "utf8"));
function collectValues(node, output = []) {
  for (const value of Object.values(node)) {
    if (typeof value === "string") output.push(value);
    else collectValues(value, output);
  }
  return output;
}

const translatedSources = new Set(collectValues(english));
const missing = [...messages]
  .filter(([message]) => !translatedSources.has(message))
  .sort(([left], [right]) => left.localeCompare(right));

if (missing.length > 0) {
  for (const [message, locations] of missing) {
    console.error(`${JSON.stringify(message)}\t${locations.slice(0, 3).join(", ")}`);
  }
  console.error(`i18n coverage failed: ${missing.length} visible messages are missing.`);
  process.exitCode = 1;
} else {
  console.log(`i18n coverage valid: ${messages.size} visible source messages are translated.`);
}
