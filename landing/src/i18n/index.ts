import en from './en';
import zh from './zh';

const locales = { en, zh } as const;
export type Locale = keyof typeof locales;

export function t(locale: Locale) {
  return locales[locale];
}

export function getLocaleFromUrl(url: URL): Locale {
  const seg = url.pathname.replace(/^\/CursorLens\/?/, '').split('/')[0];
  return seg === 'zh' ? 'zh' : 'en';
}
