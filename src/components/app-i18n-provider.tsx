"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { APP_LOCALE_COOKIE, normalizeAppLocale } from "@/i18n/config";
import {
  getAppDictionary,
  translate,
  type AppDictionary,
} from "@/i18n/dictionaries";
import type { AppLocale } from "@/lib/db";

type TranslationValues = Record<string, string | number>;

type AppI18nContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (message: string, values?: TranslationValues) => string;
};

const AppI18nContext = createContext<AppI18nContextValue | null>(null);
const LOCALIZABLE_ATTRIBUTES = ["aria-label", "placeholder", "title"] as const;
const SKIPPED_ELEMENTS = new Set(["CODE", "PRE", "SCRIPT", "STYLE", "TEXTAREA"]);

type LocalizedValue = {
  original: string;
  localized: string;
};

function preserveWhitespace(source: string, translation: string) {
  const leading = source.match(/^\s*/)?.[0] ?? "";
  const trailing = source.match(/\s*$/)?.[0] ?? "";
  return `${leading}${translation}${trailing}`;
}

function localizeTextNode(
  node: Text,
  dictionary: AppDictionary,
  originals: WeakMap<Text, LocalizedValue>,
) {
  const parent = node.parentElement;
  if (
    !parent ||
    SKIPPED_ELEMENTS.has(parent.tagName) ||
    parent.isContentEditable ||
    parent.closest("[data-i18n-ignore]")
  ) return;

  const previous = originals.get(node);
  const original =
    previous && (node.data === previous.original || node.data === previous.localized)
      ? previous.original
      : node.data;
  if (!original.trim()) return;

  const localized = translate(dictionary, original.trim());
  const next = preserveWhitespace(original, localized);
  originals.set(node, { original, localized: next });
  if (node.data !== next) node.data = next;
}

function localizeElement(
  element: Element,
  dictionary: AppDictionary,
  textOriginals: WeakMap<Text, LocalizedValue>,
  attributeOriginals: WeakMap<Element, Map<string, LocalizedValue>>,
) {
  if (SKIPPED_ELEMENTS.has(element.tagName) || element.hasAttribute("data-i18n-ignore")) return;

  for (const attribute of LOCALIZABLE_ATTRIBUTES) {
    const current = element.getAttribute(attribute);
    if (!current) continue;
    let originals = attributeOriginals.get(element);
    if (!originals) {
      originals = new Map();
      attributeOriginals.set(element, originals);
    }
    const previous = originals.get(attribute);
    const original =
      previous && (current === previous.original || current === previous.localized)
        ? previous.original
        : current;
    const localized = translate(dictionary, original);
    originals.set(attribute, { original, localized });
    if (current !== localized) element.setAttribute(attribute, localized);
  }

  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      localizeTextNode(child as Text, dictionary, textOriginals);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      localizeElement(child as Element, dictionary, textOriginals, attributeOriginals);
    }
  }
}

export function AppI18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: AppLocale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState(() => normalizeAppLocale(initialLocale));
  const textOriginals = useRef(new WeakMap<Text, LocalizedValue>());
  const attributeOriginals = useRef(
    new WeakMap<Element, Map<string, LocalizedValue>>(),
  );
  const dictionary = useMemo(() => getAppDictionary(locale), [locale]);

  const setLocale = useCallback((nextLocale: AppLocale) => {
    const normalized = normalizeAppLocale(nextLocale);
    document.cookie = `${APP_LOCALE_COOKIE}=${normalized}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setLocaleState(normalized);
  }, []);

  const t = useCallback(
    (message: string, values?: TranslationValues) => translate(dictionary, message, values),
    [dictionary],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("BigCommerce Demo Environments Manager");

    let translating = false;
    let idleCallback: number | null = null;
    let activationTimer: number | null = null;
    const pendingNodes = new Set<Node>();

    const flushPendingNodes = () => {
      idleCallback = null;
      if (translating || pendingNodes.size === 0) return;

      translating = true;
      try {
        for (const node of pendingNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            localizeTextNode(node as Text, dictionary, textOriginals.current);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            localizeElement(
              node as Element,
              dictionary,
              textOriginals.current,
              attributeOriginals.current,
            );
          }
        }
        pendingNodes.clear();
      } finally {
        translating = false;
      }
    };

    // React selectively hydrates streamed Suspense boundaries, so neither an
    // effect, animation frame, nor idle callback proves that every boundary is
    // hydrated. Do not observe or mutate the initial document during that
    // window. Client navigations remain covered once the observer is active.
    const scheduleLocalization = (node: Node) => {
      pendingNodes.add(node);
      if (idleCallback !== null) return;
      idleCallback = window.requestIdleCallback(flushPendingNodes);
    };

    const observer = new MutationObserver((mutations) => {
      if (translating) return;
      for (const mutation of mutations) {
        if (mutation.type === "characterData" || mutation.type === "attributes") {
          scheduleLocalization(mutation.target);
          continue;
        }
        for (const node of mutation.addedNodes) scheduleLocalization(node);
      }
    });
    const activate = () => {
      activationTimer = window.setTimeout(() => {
        activationTimer = null;
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: [...LOCALIZABLE_ATTRIBUTES],
        });
        scheduleLocalization(document.body);
      }, 2_000);
    };

    if (document.readyState === "complete") activate();
    else window.addEventListener("load", activate, { once: true });

    return () => {
      window.removeEventListener("load", activate);
      observer.disconnect();
      pendingNodes.clear();
      if (idleCallback !== null) window.cancelIdleCallback(idleCallback);
      if (activationTimer !== null) window.clearTimeout(activationTimer);
    };
  }, [dictionary, locale, t]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <AppI18nContext.Provider value={value}>{children}</AppI18nContext.Provider>;
}

export function useAppI18n() {
  const value = useContext(AppI18nContext);
  if (!value) throw new Error("useAppI18n must be used inside AppI18nProvider.");
  return value;
}

export function AppTranslatedText({
  message,
  values,
}: {
  message: string;
  values?: TranslationValues;
}) {
  const { t } = useAppI18n();
  return t(message, values);
}

export function AppLocaleSynchronizer({ locale }: { locale: AppLocale }) {
  const { locale: activeLocale, setLocale } = useAppI18n();

  useEffect(() => {
    if (activeLocale !== locale) setLocale(locale);
  }, [activeLocale, locale, setLocale]);

  return null;
}
