import appEn from "@/i18n/app_en.json";
import appFr from "@/i18n/app_fr.json";
import appEs from "@/i18n/app_es.json";
import appIt from "@/i18n/app_it.json";
import type { AppLocale } from "@/lib/db";

export type AppDictionary = Record<string, string>;
type AppDictionaryNode = string | { [key: string]: AppDictionaryNode };

function flattenDictionary(
  dictionary: Record<string, AppDictionaryNode>,
  prefix = "",
  flattened: AppDictionary = {},
) {
  for (const [key, value] of Object.entries(dictionary)) {
    const messageId = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      flattened[messageId] = value;
    } else {
      flattenDictionary(value, messageId, flattened);
    }
  }
  return flattened;
}

const flatAppEn = flattenDictionary(appEn as Record<string, AppDictionaryNode>);
const flatAppFr = flattenDictionary(appFr as Record<string, AppDictionaryNode>);
const flatAppEs = flattenDictionary(appEs as Record<string, AppDictionaryNode>);
const flatAppIt = flattenDictionary(appIt as Record<string, AppDictionaryNode>);

const dictionaries: Record<AppLocale, AppDictionary> = {
  en: flatAppEn,
  fr: flatAppFr,
  es: { ...flatAppEn, ...flatAppEs },
  it: { ...flatAppEn, ...flatAppIt },
};

const messageIdByEnglishSource = new Map(
  Object.entries(flatAppEn).map(([messageId, source]) => [source, messageId]),
);

type CompiledTemplate = {
  keys: string[];
  pattern: RegExp;
  translation: string;
};

const templateCache = new WeakMap<AppDictionary, CompiledTemplate[]>();

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getTemplates(dictionary: AppDictionary) {
  const cached = templateCache.get(dictionary);
  if (cached) return cached;

  const templates = Object.entries(flatAppEn).flatMap(([messageId, source]) => {
    const translation = dictionary[messageId] ?? source;
    const keys = [...source.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
    if (keys.length === 0) return [];

    let cursor = 0;
    let pattern = "^";
    for (const match of source.matchAll(/\{([^{}]+)\}/g)) {
      const index = match.index ?? cursor;
      pattern += escapeRegExp(source.slice(cursor, index));
      pattern += "(.+?)";
      cursor = index + match[0].length;
    }
    pattern += `${escapeRegExp(source.slice(cursor))}$`;

    return [{ keys, pattern: new RegExp(pattern), translation }];
  });

  templateCache.set(dictionary, templates);
  return templates;
}

export function getAppDictionary(locale: AppLocale): AppDictionary {
  return dictionaries[locale] ?? dictionaries.en;
}

export function translate(
  dictionary: AppDictionary,
  message: string,
  values?: Record<string, string | number>,
) {
  const messageId = dictionary[message] === undefined
    ? messageIdByEnglishSource.get(message)
    : message;
  let result = messageId ? dictionary[messageId] : undefined;
  let replacements = values;

  if (result === undefined && !values) {
    for (const template of getTemplates(dictionary)) {
      const match = message.match(template.pattern);
      if (!match) continue;
      result = template.translation;
      replacements = Object.fromEntries(
        template.keys.map((key, index) => [key, match[index + 1]]),
      );
      break;
    }
  }

  result ??= message;
  if (replacements) {
    for (const [key, value] of Object.entries(replacements)) {
      result = result.replaceAll(`{${key}}`, String(value));
    }
  }
  return result;
}
