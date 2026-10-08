/**
 * i18n — Arabic (default for RTL locales) + English.
 * Returns direction + strings; RN applies RTL via I18nManager at boot.
 */
import {I18nManager} from 'react-native';
import {en} from './en';
import {ar} from './ar';
import type {Strings} from './en';

export type Lang = 'ar' | 'en';

let lang: Lang = I18nManager.isRTL ? 'ar' : 'en';

export function setLang(l: Lang) {
  lang = l;
}

export function getLang(): Lang {
  return lang;
}

export function isRTL(): boolean {
  return lang === 'ar';
}

export function t(): Strings {
  return lang === 'ar' ? ar : en;
}

export const dir = (): 'rtl' | 'ltr' => (lang === 'ar' ? 'rtl' : 'ltr');
