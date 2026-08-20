import { LANGS, DEFAULT_LANG } from '../i18n/index.js';
export { LANGS, DEFAULT_LANG };

export function stripLang(pathname: string): string {
  for (const l of LANGS) {
    if (pathname === `/${l}` || pathname.startsWith(`/${l}/`)) return pathname.slice(l.length + 1) || '/';
  }
  return pathname;
}
