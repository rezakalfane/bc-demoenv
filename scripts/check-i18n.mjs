import { readFile } from "node:fs/promises";

const files = [
  "src/i18n/app_en.json",
  "src/i18n/app_fr.json",
  "src/i18n/app_es.json",
  "src/i18n/app_it.json",
];
const segmentPattern = /^[a-z][a-z0-9_]*$/;

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function flattenMessages(node, prefix = "", flattened = {}) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      flattened[path] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenMessages(value, path, flattened);
    } else {
      throw new Error(`${path}: translations must be strings or nested objects`);
    }
  }
  return flattened;
}

function duplicateObjectKeys(raw) {
  let cursor = 0;
  const repeated = [];

  function skipWhitespace() {
    while (/\s/.test(raw[cursor] ?? "")) cursor += 1;
  }

  function readString() {
    skipWhitespace();
    const start = cursor;
    if (raw[cursor] !== '"') throw new Error(`Expected string at offset ${cursor}`);
    cursor += 1;
    while (cursor < raw.length) {
      if (raw[cursor] === "\\") {
        cursor += 2;
      } else if (raw[cursor] === '"') {
        cursor += 1;
        return JSON.parse(raw.slice(start, cursor));
      } else {
        cursor += 1;
      }
    }
    throw new Error(`Unterminated string at offset ${start}`);
  }

  function readObject(path = "") {
    skipWhitespace();
    if (raw[cursor] !== "{") throw new Error(`Expected object at offset ${cursor}`);
    cursor += 1;
    const keys = new Set();
    skipWhitespace();
    while (raw[cursor] !== "}") {
      const key = readString();
      const keyPath = path ? `${path}.${key}` : key;
      if (keys.has(key)) repeated.push(keyPath);
      keys.add(key);
      skipWhitespace();
      if (raw[cursor] !== ":") throw new Error(`Expected colon at offset ${cursor}`);
      cursor += 1;
      skipWhitespace();
      if (raw[cursor] === "{") readObject(keyPath);
      else readString();
      skipWhitespace();
      if (raw[cursor] === ",") {
        cursor += 1;
        skipWhitespace();
      } else if (raw[cursor] !== "}") {
        throw new Error(`Expected comma or closing brace at offset ${cursor}`);
      }
    }
    cursor += 1;
  }

  readObject();
  skipWhitespace();
  if (cursor !== raw.length) throw new Error(`Unexpected content at offset ${cursor}`);
  return repeated;
}

const rawFiles = await Promise.all(files.map((file) => readFile(file, "utf8")));
const errors = [];

for (const [index, raw] of rawFiles.entries()) {
  try {
    const duplicateKeys = duplicateObjectKeys(raw);
    if (duplicateKeys.length > 0) {
      errors.push(`${files[index]}: duplicate keys: ${duplicateKeys.join(", ")}`);
    }
  } catch (error) {
    errors.push(`${files[index]}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const [englishTree, frenchTree] = rawFiles.map((raw) => JSON.parse(raw));
const spanishTree = JSON.parse(rawFiles[2]);
const italianTree = JSON.parse(rawFiles[3]);
const english = flattenMessages(englishTree);
const french = flattenMessages(frenchTree);
const spanish = flattenMessages(spanishTree);
const italian = flattenMessages(italianTree);
const englishKeys = Object.keys(english);
const frenchKeys = Object.keys(french);
const invalidKeys = englishKeys.filter((key) => key.split(".").some((segment) => !segmentPattern.test(segment)));
const missingFrench = englishKeys.filter((key) => !(key in french));
const extraFrench = frenchKeys.filter((key) => !(key in english));
const extraSpanish = Object.keys(spanish).filter((key) => !(key in english));
const missingSpanish = englishKeys.filter((key) => !(key in spanish));
const extraItalian = Object.keys(italian).filter((key) => !(key in english));
const missingItalian = englishKeys.filter((key) => !(key in italian));
const duplicateSources = duplicates(Object.values(english));
const emptyValues = [...new Set([
  ...englishKeys,
  ...frenchKeys,
  ...Object.keys(spanish),
  ...Object.keys(italian),
])].filter(
  (key) => !String(english[key] ?? "").trim()
    || !String(french[key] ?? "").trim()
    || !String(spanish[key] ?? "").trim()
    || !String(italian[key] ?? "").trim(),
);

if (invalidKeys.length > 0) errors.push(`Invalid resource identifiers: ${invalidKeys.join(", ")}`);
if (missingFrench.length > 0) errors.push(`Missing French keys: ${missingFrench.join(", ")}`);
if (extraFrench.length > 0) errors.push(`Unexpected French keys: ${extraFrench.join(", ")}`);
if (extraSpanish.length > 0) errors.push(`Unexpected Spanish keys: ${extraSpanish.join(", ")}`);
if (missingSpanish.length > 0) errors.push(`Missing Spanish keys: ${missingSpanish.join(", ")}`);
if (extraItalian.length > 0) errors.push(`Unexpected Italian keys: ${extraItalian.join(", ")}`);
if (missingItalian.length > 0) errors.push(`Missing Italian keys: ${missingItalian.join(", ")}`);
if (duplicateSources.length > 0) errors.push(`Duplicate English source messages: ${duplicateSources.join(" | ")}`);
if (emptyValues.length > 0) errors.push(`Empty translations: ${emptyValues.join(", ")}`);

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`i18n bundles valid: ${englishKeys.length} messages, ${files.length} locales.`);
}
