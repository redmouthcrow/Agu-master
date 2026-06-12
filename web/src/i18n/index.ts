import { computed, ref } from 'vue';
import { enUS } from './locales/en-US';
import { zhCN, type MessageKey } from './locales/zh-CN';

export type Locale = 'zh-CN' | 'en-US';

const messages: Record<Locale, Record<MessageKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export function resolveLocale(): Locale {
  const lang = (navigator.language || 'zh-CN').toLowerCase();
  if (lang.startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en-US';
}

const localeRef = ref<Locale>(resolveLocale());

export function getLocale(): Locale {
  return localeRef.value;
}

export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const dict = messages[localeRef.value] ?? messages['zh-CN'];
  let text = dict[key] ?? messages['zh-CN'][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export function useI18n() {
  return {
    locale: computed(() => localeRef.value),
    t,
  };
}

import { APP_NAME } from '../constants/app';

export function applyDocumentTitle(): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.title = `${APP_NAME} · ${t('app.tagline')}`;
}
