import fi from './fi.json';
import en from './en.json';
import sv from './sv.json';

const translations = { fi, en, sv } as const;
export type Lang = keyof typeof translations;
export const LANGS: Lang[] = ['fi', 'en', 'sv'];
export const DEFAULT_LANG: Lang = 'fi';

export function getTranslation(lang: string) {
  return (translations as Record<string, typeof fi>)[lang] ?? fi;
}
export function isValidLang(v: string | undefined): v is Lang { return (LANGS as string[]).includes(v ?? ''); }
