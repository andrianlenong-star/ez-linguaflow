import { synthesizeSpeechApi } from '../api/translatorClient.ts';
import { getLanguageByCode } from '../../shared/languages.ts';
import { normalizeSpeakableText } from '../../utils/text.ts';

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused';

export class TtsAudioController {
  private audio: HTMLAudioElement | null = null;
  private onStateChange?: (status: PlaybackStatus) => void;
  private usingSpeechSynthesis = false;
  private playbackGeneration = 0;
  private wavCache = new Map<string, string>();

  constructor(onStateChange?: (status: PlaybackStatus) => void) {
    this.onStateChange = onStateChange;
  }

  private emit(status: PlaybackStatus) {
    this.onStateChange?.(status);
  }

  private clampSpeed(speed: number): number {
    return Number.isFinite(speed) ? Math.max(0.5, Math.min(2.0, speed)) : 1.0;
  }

  async play(params: {
    text: string;
    langCode: string;
    voiceName: 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';
    speed: number;
  }): Promise<void> {
    this.stop();
    const cleanText = normalizeSpeakableText(params?.text);
    if (!cleanText) return;

    const gen = ++this.playbackGeneration;
    const rate = this.clampSpeed(params.speed);
    this.emit('loading');

    try {
      const snippet = cleanText.slice(0, 2500);
      const cacheKey = `${params.voiceName}|${snippet}`;
      let base64Wav = this.wavCache.get(cacheKey);

      if (!base64Wav) {
        const res = await synthesizeSpeechApi({
          text: snippet,
          voiceName: params.voiceName,
        });
        base64Wav = res.base64Wav;
        if (base64Wav) {
          if (this.wavCache.size >= 30) {
            const oldestKey = this.wavCache.keys().next().value;
            if (oldestKey !== undefined) this.wavCache.delete(oldestKey);
          }
          this.wavCache.set(cacheKey, base64Wav);
        }
      }

      if (gen !== this.playbackGeneration) return;
      if (!base64Wav) {
        throw new Error('TTS service returned empty audio payload.');
      }

      const audio = new Audio(`data:audio/wav;base64,${base64Wav}`);
      audio.playbackRate = rate;
      this.audio = audio;
      this.usingSpeechSynthesis = false;

      audio.onplay = () => {
        if (gen === this.playbackGeneration) this.emit('playing');
      };
      audio.onpause = () => {
        if (gen === this.playbackGeneration && !audio.ended && this.audio === audio) {
          this.emit('paused');
        }
      };
      audio.onended = () => {
        if (gen === this.playbackGeneration && this.audio === audio) {
          this.audio = null;
          this.emit('idle');
        }
      };
      audio.onerror = () => {
        if (gen === this.playbackGeneration && this.audio === audio) {
          this.audio = null;
          this.fallbackBrowserTts(cleanText, params.langCode, rate, gen);
        }
      };

      await audio.play();
    } catch {
      if (gen === this.playbackGeneration) {
        this.fallbackBrowserTts(cleanText, params.langCode, rate, gen);
      }
    }
  }

  private fallbackBrowserTts(text: string, langCode: string, speed: number, gen: number) {
    if (gen !== this.playbackGeneration) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      this.emit('idle');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const langCfg = getLanguageByCode(langCode);
    if (langCfg?.bcp47) utterance.lang = langCfg.bcp47;
    utterance.rate = this.clampSpeed(speed);
    this.usingSpeechSynthesis = true;

    utterance.onstart = () => {
      if (gen === this.playbackGeneration) this.emit('playing');
    };
    utterance.onpause = () => {
      if (gen === this.playbackGeneration) this.emit('paused');
    };
    utterance.onresume = () => {
      if (gen === this.playbackGeneration) this.emit('playing');
    };
    utterance.onend = () => {
      if (gen === this.playbackGeneration) {
        this.usingSpeechSynthesis = false;
        this.emit('idle');
      }
    };
    utterance.onerror = () => {
      if (gen === this.playbackGeneration) {
        this.usingSpeechSynthesis = false;
        this.emit('idle');
      }
    };

    window.speechSynthesis.speak(utterance);
  }

  pause(): void {
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
      this.emit('paused');
    } else if (this.usingSpeechSynthesis && 'speechSynthesis' in window) {
      window.speechSynthesis.pause();
      this.emit('paused');
    }
  }

  resume(): void {
    if (this.audio && this.audio.paused) {
      void this.audio.play();
      this.emit('playing');
    } else if (this.usingSpeechSynthesis && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
      this.emit('playing');
    }
  }

  stop(): void {
    this.playbackGeneration += 1;
    if (this.audio) {
      const old = this.audio;
      this.audio = null;
      old.onplay = null;
      old.onpause = null;
      old.onended = null;
      old.onerror = null;
      old.pause();
      old.currentTime = 0;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.usingSpeechSynthesis = false;
    this.emit('idle');
  }

  setSpeed(speed: number): void {
    if (this.audio) {
      this.audio.playbackRate = this.clampSpeed(speed);
    }
  }
}
