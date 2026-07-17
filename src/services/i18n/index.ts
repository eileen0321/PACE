import { useMemo } from 'react';
import * as Localization from 'expo-localization';
import { translations, type Locale, type TranslationKey } from './translations';
import { useSettingsStore } from '../../store/useSettingsStore';

export type { Locale, TranslationKey };

const SUPPORTED_LOCALES: Locale[] = ['en', 'ko'];

// settings.language가 'system'이면 기기 로케일을 따르되, 지원하지 않는 언어는 en으로 폴백.
export function resolveSystemLocale(): Locale {
  const deviceLanguage = Localization.getLocales()[0]?.languageCode;
  return deviceLanguage === 'ko' ? 'ko' : 'en';
}

function getByPath(obj: any, path: string): unknown {
  return path.split('.').reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), obj);
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

export function translate(locale: Locale, key: TranslationKey, params?: Record<string, string | number>): string {
  const value = getByPath(translations[locale], key) ?? getByPath(translations.en, key);
  if (typeof value !== 'string') {
    if (__DEV__) console.warn(`[i18n] Missing translation key: ${key}`);
    return key;
  }
  return interpolate(value, params);
}

// 화면에서 쓰는 훅 — settings.language를 구독해 언어 변경 시 자동 리렌더된다.
export function useTranslation() {
  const language = useSettingsStore((s) => s.settings.language);
  const locale = language === 'system' ? resolveSystemLocale() : language;
  const t = useMemo(
    () => (key: TranslationKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale]
  );
  return { t, locale };
}
