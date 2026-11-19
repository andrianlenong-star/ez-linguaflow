import { useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Loader2,
  Mic,
  Pause,
  Play,
  Square,
  Upload,
  Volume2,
} from 'lucide-react';
import { translateTextApi, translateVoiceApi } from '../lib/api/translatorClient.ts';
import type { PlaybackStatus } from '../lib/audio/ttsPlayer.ts';
import { getLanguageLabel, type LanguageConfig } from '../shared/languages.ts';
import type {
  AppSettings,
  ConversationSession,
  HistoryItem,
  ProviderId,
  VoiceTranscriptTurn,
} from '../shared/types.ts';
import { pickAudioRecordingFilename, validateAudioFile } from '../utils/text.ts';
import { LanguageSelector } from './LanguageSelector.tsx';

interface VoiceTranslateViewProps {
  settings: AppSettings;
  playbackStatus: PlaybackStatus;
  onPlaySpeech: (text: string, langCode: string, voice: AppSettings['ttsVoice'], speed: number) => void;
  onPauseSpeech: () => void;
  onResumeSpeech: () => void;
  onStopSpeech: () => void;
  onChangeSpeed: (speed: number) => void;
  onSaveHistory: (item: HistoryItem) => Promise<void>;
  onSaveConversation?: (session: ConversationSession) => Promise<void>;
}

export function VoiceTranslateView({
  settings,
  playbackStatus,
  onPlaySpeech,
  onPauseSpeech,
  onResumeSpeech,
  onStopSpeech,
  onChangeSpeed,
  onSaveHistory,
  onSaveConversation,
}: VoiceTranslateViewProps) {
  const [mode, setMode] = useState<'single' | 'conversation'>('single');
  const [speaker1Lang, setSpeaker1Lang] = useState('auto');
  const [speaker2Lang, setSpeaker2Lang] = useState(settings.defaultTargetLang || 'id');
  const [activeSpeaker, setActiveSpeaker] = useState<'speaker1' | 'speaker2'>('speaker1');

  const [ttsVoice, setTtsVoice] = useState<AppSettings['ttsVoice']>(settings.ttsVoice || 'Kore');
  const [ttsSpeed, setTtsSpeed] = useState<number>(settings.ttsSpeed || 1.0);

  const [isRecording, setIsRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micPermissionState, setMicPermissionState] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  const [transcriptText, setTranscriptText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [detectedLang, setDetectedLang] = useState<string | undefined>(undefined);
  const [conversationTurns, setConversationTurns] = useState<VoiceTranscriptTurn[]>([]);
  const [fallbackInput, setFallbackInput] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);
  const [lastProviderUsed, setLastProviderUsed] = useState<ProviderId>('gemini');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const extraLanguages: LanguageConfig[] = settings.customLanguages || [];

  const currentSourceLang = activeSpeaker === 'speaker1' ? speaker1Lang : speaker2Lang;
  const currentTargetLang = activeSpeaker === 'speaker1' ? speaker2Lang : speaker1Lang;

  async function processAudioBlob(blob: Blob, filename = 'recording.webm') {
    setProcessing(true);
    setError(null);
    setSavedNotice(false);

    try {
      const res = await translateVoiceApi({
        audioBlob: blob,
        filename,
        sourceLang: mode === 'single' ? speaker1Lang : currentSourceLang,
        targetLang: currentTargetLang,
      });

      const safeTranscript = typeof res.transcript === 'string' ? res.transcript : '';
      const safeTranslated = typeof res.translatedText === 'string' ? res.translatedText : '';

      setDetectedLang(res.detectedSourceLang);
      setTranscriptText(safeTranscript);
      setTranslatedText(safeTranslated);
      setLastProviderUsed('gemini');

      if (!safeTranscript.trim()) {
        setError(
          'No recognizable speech was detected in the audio. Try speaking closer to the microphone, uploading a clearer audio file, or using the fallback text box below.',
        );
        return;
      }

      if (mode === 'conversation' && safeTranscript.trim()) {
        const turn: VoiceTranscriptTurn = {
          id: crypto.randomUUID(),
          speaker: activeSpeaker,
          speakerLabel: activeSpeaker === 'speaker1' ? 'Speaker 1' : 'Speaker 2',
          sourceLang: currentSourceLang,
          targetLang: currentTargetLang,
          detectedLang: res.detectedSourceLang,
          originalText: safeTranscript,
          translatedText: safeTranslated,
          timestamp: Date.now(),
        };
        setConversationTurns((prev) => [...prev, turn]);
      }

      if (safeTranslated.trim()) {
        onPlaySpeech(safeTranslated, currentTargetLang, ttsVoice, ttsSpeed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice transcription and translation failed.');
    } finally {
      setProcessing(false);
    }
  }

  async function startRecording() {
    setError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicPermissionState('denied');
      setError(
        'Microphone recording is not supported in this browser context. You can upload an audio file or type below.',
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermissionState('granted');
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const recordedMime = recorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(chunksRef.current, {
          type: recordedMime,
        });
        if (audioBlob.size > 0) {
          void processAudioBlob(audioBlob, pickAudioRecordingFilename(recordedMime));
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setMicPermissionState('denied');
      setError(
        'Microphone permission was denied or no microphone device was found. Use audio upload or text fallback below.',
      );
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }

  async function handleFallbackTextTranslate() {
    const clean = fallbackInput.trim();
    if (!clean) return;
    setProcessing(true);
    setError(null);
    setSavedNotice(false);
    try {
      const res = await translateTextApi({
        text: clean,
        sourceLang: mode === 'single' ? speaker1Lang : currentSourceLang,
        targetLang: currentTargetLang,
        tone: 'natural',
        context: 'Spoken dialogue',
        provider: settings.provider,
      });
      setTranscriptText(clean);
      setTranslatedText(res.translatedText);
      setDetectedLang(res.detectedSourceLang);
      setLastProviderUsed(res.providerUsed);
      if (mode === 'conversation') {
        setConversationTurns((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            speaker: activeSpeaker,
            speakerLabel: activeSpeaker === 'speaker1' ? 'Speaker 1' : 'Speaker 2',
            sourceLang: currentSourceLang,
            targetLang: currentTargetLang,
            detectedLang: res.detectedSourceLang,
            originalText: clean,
            translatedText: res.translatedText,
            timestamp: Date.now(),
          },
        ]);
      }
      setFallbackInput('');
      onPlaySpeech(res.translatedText, currentTargetLang, ttsVoice, ttsSpeed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to translate spoken text.');
    } finally {
      setProcessing(false);
    }
  }

  async function handleSaveVoiceSession() {
    const sourceSummary =
      mode === 'conversation' && conversationTurns.length > 0
        ? conversationTurns.map((t) => `${t.speakerLabel}: ${t.originalText}`).join('\n')
        : transcriptText;
    const targetSummary =
      mode === 'conversation' && conversationTurns.length > 0
        ? conversationTurns.map((t) => `${t.speakerLabel}: ${t.translatedText}`).join('\n')
        : translatedText;

    if (!sourceSummary.trim() || !targetSummary.trim()) return;

    await onSaveHistory({
      id: crypto.randomUUID(),
      sourceText: sourceSummary,
      translatedText: targetSummary,
      sourceLang: speaker1Lang,
      detectedSourceLang: detectedLang,
      targetLang: speaker2Lang,
      tone: 'natural',
      context: mode === 'conversation' ? 'Conversation Voice Translation' : 'Voice Translation',
      provider: lastProviderUsed,
      favorite: true,
      saved: true,
      createdAt: Date.now(),
    });
    if (mode === 'conversation' && conversationTurns.length > 0 && onSaveConversation) {
      await onSaveConversation({
        id: crypto.randomUUID(),
        title: `Conversation (${getLanguageLabel(speaker1Lang)} ↔ ${getLanguageLabel(speaker2Lang)})`,
        speaker1Lang,
        speaker2Lang,
        turns: conversationTurns,
        updatedAt: Date.now(),
      });
    }
    setSavedNotice(true);
  }

  return (
    <div className="space-y-5">
      {/* Mode & Voice Configuration */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setMode('single')}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'single'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Single Voice
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('conversation');
                if (speaker1Lang === 'auto') setSpeaker1Lang('en');
              }}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'conversation'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Conversation Mode
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label
                htmlFor="tts-voice-select"
                className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
              >
                TTS Voice
              </label>
              <select
                id="tts-voice-select"
                value={ttsVoice}
                onChange={(e) => setTtsVoice(e.target.value as AppSettings['ttsVoice'])}
                className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              >
                <option value="Kore">Kore (Balanced)</option>
                <option value="Puck">Puck (Bright)</option>
                <option value="Charon">Charon (Deep)</option>
                <option value="Fenrir">Fenrir (Resonant)</option>
                <option value="Zephyr">Zephyr (Calm)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="tts-speed-range"
                className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 font-mono tabular-nums"
              >
                Speed ({ttsSpeed.toFixed(2)}x)
              </label>
              <input
                id="tts-speed-range"
                type="range"
                min={0.5}
                max={2.0}
                step={0.05}
                value={ttsSpeed}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setTtsSpeed(next);
                  onChangeSpeed(next);
                }}
                className="w-28 accent-blue-600"
              />
            </div>
          </div>
        </div>

        {/* Language Pair */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div>
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              {mode === 'conversation' ? 'Speaker 1 Language' : 'Speaker Language'}
            </span>
            <LanguageSelector
              value={speaker1Lang}
              onChange={setSpeaker1Lang}
              allowAuto={mode === 'single'}
              extraLanguages={extraLanguages}
              label="Speaker 1 language"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              const resolved1 = speaker1Lang === 'auto' ? detectedLang || 'en' : speaker1Lang;
              if (resolved1 === speaker2Lang) return;
              setSpeaker1Lang(speaker2Lang);
              setSpeaker2Lang(resolved1);
            }}
            aria-label="Swap speaker languages"
            className="mt-5 p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ArrowLeftRight className="w-4 h-4" />
          </button>

          <div>
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              {mode === 'conversation' ? 'Speaker 2 Language' : 'Translate To'}
            </span>
            <LanguageSelector
              value={speaker2Lang}
              onChange={setSpeaker2Lang}
              extraLanguages={extraLanguages}
              label="Speaker 2 language"
            />
          </div>

          {mode === 'conversation' && (
            <div className="mt-5 flex items-center gap-2 ml-auto">
              <span className="text-xs text-slate-500 dark:text-slate-400">Active turn:</span>
              <button
                type="button"
                onClick={() =>
                  setActiveSpeaker((prev) => (prev === 'speaker1' ? 'speaker2' : 'speaker1'))
                }
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
              >
                {activeSpeaker === 'speaker1'
                  ? `Speaker 1 (${getLanguageLabel(speaker1Lang)}) → Switch`
                  : `Speaker 2 (${getLanguageLabel(speaker2Lang)}) → Switch`}
              </button>
            </div>
          )}
        </div>

        {/* Recording Controls */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          {!isRecording ? (
            <button
              type="button"
              onClick={() => void startRecording()}
              disabled={processing}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Mic className="w-4 h-4" />
              <span>
                {mode === 'conversation'
                  ? `Record ${activeSpeaker === 'speaker1' ? 'Speaker 1' : 'Speaker 2'}`
                  : 'Start Microphone Recording'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              <Square className="w-4 h-4" />
              <span>Stop & Translate</span>
            </button>
          )}

          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.webm,.ogg,.m4a,.aac,.flac"
            aria-label="Upload audio recording"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const check = validateAudioFile(file.name, file.size);
              if (!check.valid) {
                setError(check.error || 'Invalid audio file.');
                return;
              }
              void processAudioBlob(file, file.name);
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => audioInputRef.current?.click()}
            disabled={processing}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Upload className="w-4 h-4" />
            <span>Upload Audio File</span>
          </button>

          {processing && (
            <span className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              <span>Transcribing & translating speech...</span>
            </span>
          )}
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Turn-based voice mode records audio segments via your browser microphone and transcribes with Gemini speech recognition ({micPermissionState === 'denied' ? 'Mic permission denied — fallback enabled below' : 'Microphone ready'}).
        </p>

        {/* Browser fallback text-to-voice input */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={fallbackInput}
            onChange={(e) => setFallbackInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleFallbackTextTranslate();
            }}
            placeholder={`Fallback input: type spoken phrase (${getLanguageLabel(currentSourceLang)} → ${getLanguageLabel(currentTargetLang)})...`}
            aria-label="Fallback voice phrase input"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          />
          <button
            type="button"
            onClick={() => void handleFallbackTextTranslate()}
            disabled={processing || !fallbackInput.trim()}
            className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            Translate & Speak
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {/* Playback Controls & Latest Transcript */}
      {(transcriptText || translatedText) && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Audio Playback & Transcript
              </span>
              {detectedLang && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  · Detected: {getLanguageLabel(detectedLang)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {playbackStatus === 'playing' ? (
                <button
                  type="button"
                  onClick={onPauseSpeech}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </button>
              ) : playbackStatus === 'paused' ? (
                <button
                  type="button"
                  onClick={onResumeSpeech}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Resume</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    onPlaySpeech(translatedText, currentTargetLang, ttsVoice, ttsSpeed)
                  }
                  disabled={!translatedText || playbackStatus === 'loading'}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{playbackStatus === 'loading' ? 'Generating Audio...' : 'Play'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={onStopSpeech}
                disabled={playbackStatus === 'idle'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-40"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Stop</span>
              </button>

              <button
                type="button"
                onClick={() => void handleSaveVoiceSession()}
                disabled={savedNotice}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
              >
                {savedNotice ? 'Saved' : 'Save Transcript'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Original Transcript
              </h3>
              <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                {transcriptText}
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Translated Speech
              </h3>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-50 whitespace-pre-wrap">
                {translatedText}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Conversation Log */}
      {mode === 'conversation' && conversationTurns.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Conversation Transcript ({conversationTurns.length} turns)
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {conversationTurns.map((turn) => (
              <div key={turn.id} className="py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                    {turn.speakerLabel} · {getLanguageLabel(turn.sourceLang)} →{' '}
                    {getLanguageLabel(turn.targetLang)}
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{turn.originalText}</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                    {turn.translatedText}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onPlaySpeech(turn.translatedText, turn.targetLang, ttsVoice, ttsSpeed)}
                  aria-label={`Play turn from ${turn.speakerLabel}`}
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0 self-start"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
