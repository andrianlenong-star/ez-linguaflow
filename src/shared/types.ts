export type TranslationTone =
  | 'natural'
  | 'formal'
  | 'informal'
  | 'professional'
  | 'academic'
  | 'business'
  | 'casual'
  | 'technical'
  | 'custom';

export type FormalityLevel = 'default' | 'more_formal' | 'less_formal';

export type ProviderId = 'gemini' | 'deepl';

export interface GlossaryTerm {
  id: string;
  sourceTerm: string;
  targetTerm: string;
  notes?: string;
}

export interface Glossary {
  id: string;
  userId?: string;
  name: string;
  sourceLang: string;
  targetLang: string;
  enabled: boolean;
  terms: GlossaryTerm[];
  deleted?: boolean;
  updatedAt: number;
}

export interface AppliedGlossaryEntry {
  sourceTerm: string;
  targetTerm: string;
}

export interface StyleProfile {
  id: string;
  userId?: string;
  name: string;
  tone: TranslationTone;
  formality: FormalityLevel;
  writingStyle: string;
  preferredTerminology: string;
  customInstructions: string;
  isDefault?: boolean;
  deleted?: boolean;
  updatedAt: number;
}

export interface TranslationRequest {
  text: string;
  sourceLang: string; // 'auto' or language code
  targetLang: string;
  tone: TranslationTone;
  formality?: FormalityLevel;
  context?: string;
  customToneDescription?: string;
  styleProfile?: Pick<
    StyleProfile,
    'writingStyle' | 'preferredTerminology' | 'customInstructions'
  >;
  glossaryTerms?: AppliedGlossaryEntry[];
  provider?: ProviderId;
}

export interface TranslationResult {
  translatedText: string;
  detectedSourceLang?: string;
  detectedSourceLangName?: string;
  providerUsed: ProviderId;
  modelUsed?: string;
  appliedTerms: AppliedGlossaryEntry[];
  uncertaintyNotice?: string;
}

export interface AlternativeTranslation {
  translation: string;
  nuanceDifference: string;
  usageContext: string;
  formalityLevel: string;
  isMostNatural: boolean;
}

export interface AlternativesResponse {
  alternatives: AlternativeTranslation[];
  providerUsed: ProviderId;
}

export interface DictionaryExample {
  source: string;
  target: string;
}

export interface DictionaryEntry {
  word: string;
  contextualTranslation: string;
  partOfSpeech: string;
  pronunciation?: string;
  definition: string;
  synonyms: string[];
  antonyms: string[];
  examples: DictionaryExample[];
  usageAlternatives: string[];
  detectedLanguage?: string;
}

export interface DocumentTranslationResult {
  originalFilename: string;
  format: 'pdf' | 'docx' | 'pptx' | 'txt' | 'html';
  detectedSourceLang?: string;
  originalPreview: string;
  translatedPreview: string;
  translatedHtml?: string;
  downloadFilename: string;
  downloadMimeType: string;
  downloadBase64: string;
  fallbackTextDownloadFilename?: string;
  fallbackTextBase64?: string;
  preservesLayout: boolean;
  limitationNote?: string;
  ocrUsed: boolean;
  segmentCount: number;
}

export interface ImageRegion {
  id: string;
  originalText: string;
  translatedText: string;
  /** Normalized 0..1000 coordinates [ymin, xmin, ymax, xmax] */
  box2d: [number, number, number, number];
  confidence: 'high' | 'medium' | 'low';
}

export interface ImageTranslationResult {
  detectedSourceLang: string;
  regions: ImageRegion[];
  fullOriginalText: string;
  fullTranslatedText: string;
  unreadableSections: string[];
  modelUsed?: string;
}

export interface VoiceTranscriptTurn {
  id: string;
  speaker: 'speaker1' | 'speaker2';
  speakerLabel: string;
  sourceLang: string;
  targetLang: string;
  detectedLang?: string;
  originalText: string;
  translatedText: string;
  timestamp: number;
}

export interface VoiceTranslationResult {
  detectedSourceLang: string;
  transcript: string;
  translatedText: string;
}

export interface HistoryItem {
  id: string;
  userId?: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  detectedSourceLang?: string;
  targetLang: string;
  tone: TranslationTone;
  context?: string;
  provider: ProviderId;
  favorite: boolean;
  saved: boolean;
  deleted?: boolean;
  createdAt: number;
  updatedAt?: number;
}

export interface SavedTranslation {
  id: string;
  userId?: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  detectedSourceLang?: string;
  targetLang: string;
  tone: TranslationTone;
  context?: string;
  provider: ProviderId;
  tags: string[];
  deleted?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationSession {
  id: string;
  userId?: string;
  title: string;
  speaker1Lang: string;
  speaker2Lang: string;
  turns: VoiceTranscriptTurn[];
  deleted?: boolean;
  updatedAt: number;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoUrl?: string;
  platformLastSeen: 'web' | 'android' | 'shared';
}

export interface DetectLanguageRequest {
  text: string;
}

export interface DetectLanguageResult {
  detectedLang: string;
  languageName: string;
  confidence: 'high' | 'medium' | 'low';
  isRtl: boolean;
  providerUsed: ProviderId;
}

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  available: boolean;
  model?: string;
  note: string;
}

export interface AppSettings {
  theme: 'light' | 'dark';
  provider: ProviderId;
  autoTranslate: boolean;
  autoSaveHistory: boolean;
  defaultSourceLang: string;
  defaultTargetLang: string;
  defaultTone: TranslationTone;
  defaultFormality: FormalityLevel;
  ttsVoice: 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';
  ttsSpeed: number;
  showPrivacyNotice: boolean;
  updatedAt?: number;
  customLanguages: Array<{
    code: string;
    name: string;
    nativeName: string;
    bcp47: string;
    rtl?: boolean;
    supportsFormality: boolean;
  }>;
}

export interface SyncPullResponse {
  serverTimeMs: number;
  profile: UserProfile | null;
  preferences: AppSettings | null;
  history: HistoryItem[];
  savedTranslations: SavedTranslation[];
  glossaries: Glossary[];
  styleProfiles: StyleProfile[];
  conversations: ConversationSession[];
}

export interface SyncPushRequest {
  preferences?: AppSettings;
  history?: HistoryItem[];
  savedTranslations?: SavedTranslation[];
  glossaries?: Glossary[];
  styleProfiles?: StyleProfile[];
  conversations?: ConversationSession[];
}

export interface SyncPushResponse {
  serverTimeMs: number;
  accepted: {
    preferences: boolean;
    history: number;
    savedTranslations: number;
    glossaries: number;
    styleProfiles: number;
    conversations: number;
  };
}

export type NavView =
  | 'translate'
  | 'documents'
  | 'images'
  | 'voice'
  | 'dictionary'
  | 'glossary'
  | 'history'
  | 'settings';

