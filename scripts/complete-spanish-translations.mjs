import { readFile, writeFile } from "node:fs/promises";

const locale = process.argv[2] ?? "es";
if (locale !== "es" && locale !== "it") {
  throw new Error("Supported generated locales are es and it.");
}
const languageName = locale === "it" ? "Italian" : "Spanish";
const englishPath = new URL("../src/i18n/app_en.json", import.meta.url);
const targetPath = new URL(`../src/i18n/app_${locale}.json`, import.meta.url);
const english = JSON.parse(await readFile(englishPath, "utf8"));
const existingTarget = JSON.parse(await readFile(targetPath, "utf8"));

function flatten(node, prefix = "", output = {}) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") output[path] = value;
    else flatten(value, path, output);
  }
  return output;
}

function unflatten(template, translations, prefix = "") {
  return Object.fromEntries(Object.entries(template).map(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [key, typeof value === "string"
      ? translations[path]
      : unflatten(value, translations, path)];
  }));
}

function protect(message) {
  const replacements = [];
  const text = message.replace(/\{[^{}]+\}|BigCommerce|Turso|SQLite|Catalyst|Stencil|Vercel|B2B|CLEAR/g, (value) => {
    const token = `__BC_TOKEN_${replacements.length}__`;
    replacements.push([token, value]);
    return token;
  });
  return { text, replacements };
}

function restore(message, replacements) {
  return replacements.reduce(
    (result, [token, value]) => result.replaceAll(token, value),
    message,
  );
}

async function translateMessage(message, attempt = 1) {
  const { text, replacements } = protect(message);
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "en");
  url.searchParams.set("tl", locale);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const translated = Array.isArray(payload?.[0])
      ? payload[0].map((part) => String(part?.[0] ?? "")).join("")
      : "";
    if (!translated) throw new Error("Empty translation");
    return restore(translated, replacements);
  } catch (error) {
    if (attempt >= 4) throw error;
    await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    return translateMessage(message, attempt + 1);
  }
}

const englishFlat = flatten(english);
const targetFlat = flatten(existingTarget);
const missing = Object.entries(englishFlat).filter(([key]) => !(key in targetFlat));
let cursor = 0;
let completed = 0;
const workerCount = 6;

async function worker() {
  while (cursor < missing.length) {
    const index = cursor++;
    const [key, source] = missing[index];
    targetFlat[key] = await translateMessage(source);
    completed += 1;
    if (completed % 50 === 0 || completed === missing.length) {
      console.log(`Translated ${completed}/${missing.length} missing messages`);
    }
  }
}

await Promise.all(Array.from({ length: workerCount }, () => worker()));
await writeFile(
  targetPath,
  `${JSON.stringify(unflatten(english, targetFlat), null, 2)}\n`,
  "utf8",
);
console.log(`${languageName} catalog complete: ${Object.keys(englishFlat).length} messages.`);
