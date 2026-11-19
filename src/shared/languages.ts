export interface LanguageConfig {
  code: string;
  name: string;
  nativeName: string;
  bcp47: string;
  rtl?: boolean;
  supportsFormality: boolean;
  deepLCode?: string;
}

export const SUPPORTED_LANGUAGES: LanguageConfig[] = [
  { code: 'en', name: 'English', nativeName: 'English', bcp47: 'en-US', supportsFormality: false, deepLCode: 'EN' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', bcp47: 'id-ID', supportsFormality: true, deepLCode: 'ID' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', bcp47: 'ja-JP', supportsFormality: true, deepLCode: 'JA' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', bcp47: 'ko-KR', supportsFormality: true, deepLCode: 'KO' },
  { code: 'zh-Hans', name: 'Chinese (Simplified)', nativeName: '简体中文', bcp47: 'zh-CN', supportsFormality: true, deepLCode: 'ZH-HANS' },
  { code: 'zh-Hant', name: 'Chinese (Traditional)', nativeName: '繁體中文', bcp47: 'zh-TW', supportsFormality: true, deepLCode: 'ZH-HANT' },
  { code: 'fr', name: 'French', nativeName: 'Français', bcp47: 'fr-FR', supportsFormality: true, deepLCode: 'FR' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', bcp47: 'de-DE', supportsFormality: true, deepLCode: 'DE' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', bcp47: 'es-ES', supportsFormality: true, deepLCode: 'ES' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', bcp47: 'pt-BR', supportsFormality: true, deepLCode: 'PT-BR' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', bcp47: 'it-IT', supportsFormality: true, deepLCode: 'IT' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', bcp47: 'nl-NL', supportsFormality: true, deepLCode: 'NL' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', bcp47: 'ru-RU', supportsFormality: true, deepLCode: 'RU' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', bcp47: 'ar-SA', rtl: true, supportsFormality: true, deepLCode: 'AR' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', bcp47: 'tr-TR', supportsFormality: true, deepLCode: 'TR' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', bcp47: 'vi-VN', supportsFormality: true },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', bcp47: 'th-TH', supportsFormality: true },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', bcp47: 'ms-MY', supportsFormality: true },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', bcp47: 'hi-IN', supportsFormality: true },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', bcp47: 'pl-PL', supportsFormality: true, deepLCode: 'PL' },
];

export const AUTO_DETECT_CODE = 'auto';

export function getLanguageByCode(
  code: string,
  extraLanguages: LanguageConfig[] = [],
): LanguageConfig | undefined {
  const all = [...SUPPORTED_LANGUAGES, ...extraLanguages];
  return all.find((lang) => lang.code.toLowerCase() === code.toLowerCase());
}

export function getLanguageLabel(
  code: string,
  extraLanguages: LanguageConfig[] = [],
): string {
  if (code === AUTO_DETECT_CODE) return 'Auto Detect';
  return getLanguageByCode(code, extraLanguages)?.name ?? code;
}

export function isRtlLanguage(code: string, extraLanguages: LanguageConfig[] = []): boolean {
  return Boolean(getLanguageByCode(code, extraLanguages)?.rtl);
}

export function searchLanguages(
  query: string,
  extraLanguages: LanguageConfig[] = [],
): LanguageConfig[] {
  const all = [...SUPPORTED_LANGUAGES, ...extraLanguages];
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter(
    (lang) =>
      lang.name.toLowerCase().includes(q) ||
      lang.nativeName.toLowerCase().includes(q) ||
      lang.code.toLowerCase().includes(q),
  );
}
