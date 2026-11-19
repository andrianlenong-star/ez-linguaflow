import type {
  AlternativesResponse,
  ProviderId,
  TranslationRequest,
  TranslationResult,
} from '../../src/shared/types.ts';

export interface TranslationProvider {
  id: ProviderId;
  name: string;
  isConfigured(): boolean;
  getModelName(): string | undefined;
  translate(
    request: TranslationRequest,
    options?: { timeoutMs?: number; fallbackTimeoutMs?: number; maxRetries?: number },
  ): Promise<TranslationResult>;
  getAlternatives(request: TranslationRequest): Promise<AlternativesResponse>;
}
