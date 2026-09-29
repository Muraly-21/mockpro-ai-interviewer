/**
 * useVoiceInterviewer.js – Reliable Voice Hook for MockPro
 *
 * Architecture (confirmed working with this API key):
 *
 *  TTS (AI speaks):
 *    PRIMARY:  Gemini TTS REST (models/gemini-3.8-flash-tts) → real WAV audio → Web Audio API
 *    FALLBACK: Web Speech API (window.speechSynthesis + best available English voice)
 *
 *  STT (candidate speaks):
 *    PRIMARY:  webkitSpeechRecognition (Chrome native, zero-quota)
 *    FALLBACK: MediaRecorder + Groq Whisper (whisper-large-v3-turbo)
 *
 *  LLM (AI responds to candidate):
 *    PRIMARY:  Groq (qwen/qwen3.8-27b)
 *    FALLBACK: Groq cascade (openai/gpt-oss-120b, openai/gpt-oss-20b)
 *
 * NOTE: Gemini Live WebSocket (bidiGenerateContent) is NOT used because the
 * configured API key does not have access to Live-capable models. The
 * geminiLiveService.js is preserved but bypassed.
 *
 * Barge-in: ttsService.cancel() on voice onset stops Gemini TTS or Web Speech.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { speak as ttsspeak, cancel as ttsCancel } from '../services/ttsService';
import { chatCompletion, extractContent, transcribeAudio, DEFAULT_MODEL } from '../services/groqService';
import { setEvaluatorEngine } from '../services/socraticEvaluator';
import { useInterview } from '../context/InterviewContext';

// ─── Engine / Speaking State ──────────────────────────────────────────────────

export const ENGINE = {
  NONE:          'none',
  GEMINI_LIVE:   'groq-tts',   // renamed for compat; now means Gemini TTS + Groq LLM
  GROQ_FALLBACK: 'groq-fallback',
};

export const SPEAKING_STATE = {
  IDLE:               'idle',
  AI_SPEAKING:        'ai-speaking',
  CANDIDATE_SPEAKING: 'candidate-speaking',
  PROCESSING:         'processing',
};

// ─── System Prompt ────────────────────────────────────────────────────────────

const VOICE_SYSTEM_INSTRUCTION = `You are a Senior Staff Software Engineer conducting a MAANG-style technical interview for MockPro.
Rules:
1. Speak ONLY in plain sentences. No markdown, bullets, asterisks, code blocks, or lists.
2. Keep every response to 15–25 words maximum. Be punchy and direct.
3. Be encouraging but rigorous. Push the candidate to think deeper.
4. Ask one focused follow-up question at a time.`;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useVoiceInterviewer
 *
 * @param {Object}   opts
 * @param {string}   opts.systemPrompt  – Phase-specific context appended to system instruction
 * @param {Function} opts.onTranscript  – ({speaker, text}) called for each utterance
 * @param {Function} opts.onToolCall    – (ignored; kept for API compat)
 * @param {Function} opts.onError       – (message) error callback
 */
export default function useVoiceInterviewer({
  systemPrompt = '',
  onTranscript,
  onError,
  disableAutoLLM = false,
} = {}) {
  const { appendTranscript } = useInterview();

  const [engine,        setEngine]        = useState(ENGINE.NONE);
  const [speakingState, setSpeakingState] = useState(SPEAKING_STATE.IDLE);
  const [isInitialising, setIsInitialising] = useState(false);
  const [isMicOn,       setIsMicOn]       = useState(false);
  const [isTTSOn,       setIsTTSOn]       = useState(true);
  const [transcript,    setTranscript]    = useState([]);
  const [micLevel,      setMicLevel]      = useState(0);
  const [interimText,   setInterimText]   = useState('');

  // Refs
  const speechRecRef        = useRef(null);   // webkitSpeechRecognition
  const mediaRecRef         = useRef(null);   // MediaRecorder (Whisper backup)
  const whisperAbort        = useRef(null);
  const groqAbort           = useRef(null);
  const micLevelTimer       = useRef(null);
  const analyserRef         = useRef(null);
  const micStreamRef        = useRef(null);
  const audioCtxRef         = useRef(null);
  const isMounted           = useRef(true);
  const isMicOnRef          = useRef(false);  // sync ref for recognition.onend closure
  const speakingStateRef    = useRef(SPEAKING_STATE.IDLE);
  const voiceLevelTicksRef  = useRef(0);
  const isDeliveringQuestionRef = useRef(false);
  const speechDebounceTimer = useRef(null);
  const accumulatedSpeechRef = useRef('');
  const interimTextRef      = useRef('');
  const startSpeechRecRef   = useRef(null);
  const aiSpeakStartRef     = useRef(0);

  // Build system history once (ref so it survives re-renders without adding deps)
  const groqHistory = useRef([
    { role: 'system', content: [VOICE_SYSTEM_INSTRUCTION, systemPrompt].filter(Boolean).join('\n\n') },
  ]);

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      _stopMicLevelPoll();
      _stopSpeechRec();
      _stopMediaRec();
      ttsCancel();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Internal helpers ────────────────────────────────────────────────────────

  function _setSpeakingState(s) {
    speakingStateRef.current = s;
    if (isMounted.current) setSpeakingState(s);
  }

  function _addTranscriptEntry(entry) {
    if (!isMounted.current) return;
    const full = { ...entry, ts: Date.now() };
    setTranscript(prev => [...prev, full]);
    appendTranscript(full);
    onTranscript?.(full);
  }

  function _stopSpeechRec() {
    if (speechRecRef.current) {
      try {
        speechRecRef.current.onend = null;
        speechRecRef.current.onerror = null;
        speechRecRef.current.stop();
      } catch {}
      try { speechRecRef.current.abort(); } catch {}
      speechRecRef.current = null;
    }
  }

  function _stopMediaRec() {
    if (mediaRecRef.current?.state === 'recording') {
      try { mediaRecRef.current.stop(); } catch {}
    }
    mediaRecRef.current = null;
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
  }

  function _stopMicLevelPoll() {
    if (micLevelTimer.current) {
      clearInterval(micLevelTimer.current);
      micLevelTimer.current = null;
    }
    voiceLevelTicksRef.current = 0;
    setMicLevel(0);
  }

  function _startMicLevelPoll(analyser) {
    if (micLevelTimer.current) return;
    analyserRef.current = analyser;
    voiceLevelTicksRef.current = 0;
    micLevelTimer.current = setInterval(() => {
      if (!analyserRef.current) return;
      const buf = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) {
        const d = (v - 128) / 128;
        sum += d * d;
      }
      const rms = Math.sqrt(sum / buf.length);
      // Scaled level 0..1 matching AudioHardwareCheckModal responsiveness
      const level = Math.min(1, rms * 4.5);
      setMicLevel(level);

      // Barge-in: only cancel AI TTS when candidate's deliberate voice exceeds high threshold
      // and only after AI has spoken for at least 2.5 seconds to prevent initial speaker echo
      const isLongSpeaking = speakingStateRef.current === SPEAKING_STATE.AI_SPEAKING && (Date.now() - aiSpeakStartRef.current > 2500);
      if (!isDeliveringQuestionRef.current && isLongSpeaking && level > 0.35) {
        voiceLevelTicksRef.current += 1;
        if (voiceLevelTicksRef.current >= 5) {
          console.info('[useVoiceInterviewer] Deliberate candidate barge-in detected - interrupting AI.');
          ttsCancel();
          _setSpeakingState(SPEAKING_STATE.CANDIDATE_SPEAKING);
        }
      } else {
        voiceLevelTicksRef.current = 0;
      }
    }, 50);
  }

  // ── TTS (speak) ─────────────────────────────────────────────────────────────

  /**
   * Speak text via Gemini TTS → Web Speech API fallback.
   * This is the ONLY TTS entry point. Always use this.
   */
  const speak = useCallback(async (text, onEnd) => {
    if (!isTTSOn || !text?.trim()) { onEnd?.(); return; }

    const wasMicRunning = isMicOnRef.current;
    if (speechRecRef.current) {
      _stopSpeechRec();
    }
    aiSpeakStartRef.current = Date.now();
    _setSpeakingState(SPEAKING_STATE.AI_SPEAKING);

    await ttsspeak(text, {
      onStart: () => {
        aiSpeakStartRef.current = Date.now();
        _setSpeakingState(SPEAKING_STATE.AI_SPEAKING);
      },
      onEnd: () => {
        if (speakingStateRef.current === SPEAKING_STATE.AI_SPEAKING) {
          _setSpeakingState(SPEAKING_STATE.IDLE);
        }
        // Smoothly resume recognition after AI is done speaking
        if (isMounted.current && wasMicRunning) {
          setTimeout(() => {
            if (isMounted.current && isMicOnRef.current && speakingStateRef.current !== SPEAKING_STATE.AI_SPEAKING) {
              startSpeechRecRef.current?.();
            }
          }, 200);
        }
        onEnd?.();
      },
    });
  }, [isTTSOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Groq LLM Turn ──────────────────────────────────────────────────────────

  const processGroqTurn = useCallback(async (candidateText) => {
    if (!candidateText?.trim() || !isMounted.current) return;

    _addTranscriptEntry({ speaker: 'Candidate', text: candidateText });
    _setSpeakingState(SPEAKING_STATE.PROCESSING);

    groqHistory.current.push({ role: 'user', content: candidateText });

    groqAbort.current?.abort();
    groqAbort.current = new AbortController();

    const result = await chatCompletion(groqHistory.current, {
      model:       DEFAULT_MODEL,
      temperature: 0.65,
      maxTokens:   100,
      signal:      groqAbort.current.signal,
    });

    if (!isMounted.current) return;
    if (result.error) {
      console.warn('[useVoiceInterviewer] Groq LLM error:', result.error);
      _setSpeakingState(SPEAKING_STATE.IDLE);
      return;
    }

    let aiText = extractContent(result.data)
      .replace(/[*_`#\[\]]/g, '')
      .replace(/\n+/g, ' ')
      .trim();

    // Word-count ceiling: keep spoken responses punchy
    const words = aiText.split(/\s+/);
    if (words.length > 30) aiText = words.slice(0, 28).join(' ') + '.';

    groqHistory.current.push({ role: 'assistant', content: aiText });
    _addTranscriptEntry({ speaker: 'AI', text: aiText });

    // Temporarily pause mic input while AI speaks follow-up to prevent speaker echo / feedback
    isDeliveringQuestionRef.current = true;
    _stopSpeechRec();
    await speak(aiText, () => {
      isDeliveringQuestionRef.current = false;
      if (isMounted.current && isMicOnRef.current) {
        startSpeechRecRef.current?.();
      }
    });
  }, [speak]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Utterance Finalizer ─────────────────────────────────────────────────────

  const _finalizeUtterance = useCallback(async () => {
    if (speechDebounceTimer.current) {
      clearTimeout(speechDebounceTimer.current);
      speechDebounceTimer.current = null;
    }
    const fullResponse = (accumulatedSpeechRef.current + (interimTextRef.current ? ' ' + interimTextRef.current : '')).trim();
    if (!fullResponse || !isMounted.current) return;

    accumulatedSpeechRef.current = '';
    interimTextRef.current = '';
    setInterimText('');

    if (disableAutoLLM) {
      _addTranscriptEntry({ speaker: 'Candidate', text: fullResponse });
      _setSpeakingState(SPEAKING_STATE.IDLE);
    } else {
      await processGroqTurn(fullResponse);
    }
  }, [disableAutoLLM, processGroqTurn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mic Audio Analyser (Initialized once) ───────────────────────────────────

  const _ensureMicStreamAndAnalyser = useCallback(async () => {
    if (micStreamRef.current && analyserRef.current) return micStreamRef.current;
    if (!navigator.mediaDevices?.getUserMedia) return null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true }, // Prevents AI TTS speaker bleed into mic
          noiseSuppression: { ideal: true }, // Suppresses background fan/air conditioner hum
          autoGainControl:  { ideal: true }, // Dynamically boosts soft voices so user does not need to shout
          channelCount:     1,
          sampleRate:       { ideal: 48000 },
          sampleSize:       { ideal: 16 },
        },
      });
      if (!isMounted.current) {
        stream.getTracks().forEach(t => t.stop());
        return null;
      }
      micStreamRef.current = stream;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        let ctx = audioCtxRef.current;
        if (!ctx || ctx.state === 'closed') {
          ctx = new AudioCtx();
          audioCtxRef.current = ctx;
        }
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }
        const source = ctx.createMediaStreamSource(stream);
        const gainNode = ctx.createGain();
        gainNode.gain.value = 2.5; // High sensitivity boost for conversational volume
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(gainNode);
        gainNode.connect(analyser);
        _startMicLevelPoll(analyser);
      }
      return stream;
    } catch (err) {
      console.warn('[useVoiceInterviewer] getUserMedia non-fatal error:', err);
      return null;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── STT: webkitSpeechRecognition ────────────────────────────────────────────

  const startSpeechRecognition = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;

    try {
      _stopSpeechRec();

      const rec = new SR();
      rec.continuous     = true;
      rec.interimResults = true;
      // Use candidate locale or fallback to English India / English US
      rec.lang           = (typeof navigator !== 'undefined' && navigator.language) || 'en-IN';
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        if (isMounted.current) {
          setIsMicOn(true);
          isMicOnRef.current = true;
          if (speakingStateRef.current !== SPEAKING_STATE.AI_SPEAKING) {
            _setSpeakingState(SPEAKING_STATE.IDLE);
          }
        }
      };

      // Candidate begins speaking -> barge-in occurs here
      rec.onspeechstart = () => {
        if (isMounted.current) {
          if (speakingStateRef.current === SPEAKING_STATE.AI_SPEAKING) {
            // Only allow barge-in after 2.5s of speech to prevent immediate cut-off from speaker echo
            if (Date.now() - aiSpeakStartRef.current > 2500) {
              console.info('[useVoiceInterviewer] Candidate started speaking, interrupting AI TTS.');
              ttsCancel();
              _setSpeakingState(SPEAKING_STATE.CANDIDATE_SPEAKING);
            }
            return;
          }
          _setSpeakingState(SPEAKING_STATE.CANDIDATE_SPEAKING);
        }
      };

      rec.onsoundstart = () => {
        if (isMounted.current && speakingStateRef.current !== SPEAKING_STATE.AI_SPEAKING) {
          _setSpeakingState(SPEAKING_STATE.CANDIDATE_SPEAKING);
        }
      };

      rec.onresult = (event) => {
        let currentInterim = '';
        let currentFinal = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          const transcriptPiece = item[0]?.transcript || '';
          if (item.isFinal) {
            currentFinal += transcriptPiece + ' ';
          } else {
            currentInterim += transcriptPiece;
          }
        }

        if (currentInterim.trim() || currentFinal.trim()) {
          if (speakingStateRef.current === SPEAKING_STATE.AI_SPEAKING) {
            ttsCancel();
          }
          _setSpeakingState(SPEAKING_STATE.CANDIDATE_SPEAKING);
        }

        if (currentFinal.trim()) {
          accumulatedSpeechRef.current = (accumulatedSpeechRef.current + ' ' + currentFinal.trim()).trim();
          interimTextRef.current = '';
          setInterimText('');
        }

        if (currentInterim) {
          interimTextRef.current = currentInterim;
          setInterimText(currentInterim);
        }

        // Set debounce timer: candidate pauses for 2.2 seconds after speaking, submit turn
        if (speechDebounceTimer.current) clearTimeout(speechDebounceTimer.current);
        speechDebounceTimer.current = setTimeout(async () => {
          await _finalizeUtterance();
        }, 2200);
      };

      rec.onerror = (e) => {
        console.warn('[STT] SpeechRecognition event:', e.error);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          if (isMounted.current) {
            setIsMicOn(false);
            isMicOnRef.current = false;
            _setSpeakingState(SPEAKING_STATE.IDLE);
          }
        }
        // For 'no-speech' or 'network', do NOT unset isMicOnRef so onend restarts cleanly
      };

      // Resilient auto-restart on end while mic is still active
      rec.onend = () => {
        // Do not force-submit on cycle restart; allow debounce timer or explicit submit to finish complete thoughts
        if (isMicOnRef.current && isMounted.current) {
          setTimeout(() => {
            if (isMicOnRef.current && isMounted.current) {
              startSpeechRecognition();
            }
          }, 80);
        } else if (isMounted.current) {
          setIsMicOn(false);
          _setSpeakingState(SPEAKING_STATE.IDLE);
        }
      };

      rec.start();
      speechRecRef.current = rec;
      startSpeechRecRef.current = startSpeechRecognition;

      // Ensure single persistent mic stream for live audio visualization
      _ensureMicStreamAndAnalyser();

      return true;
    } catch (err) {
      console.warn('[STT] SpeechRecognition init failed:', err.message);
      return false;
    }
  }, [_finalizeUtterance, _ensureMicStreamAndAnalyser]);

  // ── STT: Groq Whisper (MediaRecorder fallback) ──────────────────────────────

  const startWhisperMic = useCallback(async () => {
    if (mediaRecRef.current) return;

    let stream = await _ensureMicStreamAndAnalyser();
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;
      } catch (err) {
        onError?.(`Microphone denied: ${err.message}`);
        return;
      }
    }

    let chunks = [];
    let rec;
    try {
      rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    } catch {
      rec = new MediaRecorder(stream);
    }

    rec.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
        // Transcribe every 3 seconds of captured speech
        if (chunks.length >= 3 && isMounted.current) {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          chunks = [];
          whisperAbort.current?.abort();
          whisperAbort.current = new AbortController();
          const { text, error } = await transcribeAudio(blob, whisperAbort.current.signal);
          if (!error && text?.trim() && isMounted.current) {
            const spoken = text.trim();
            if (disableAutoLLM) {
              _addTranscriptEntry({ speaker: 'Candidate', text: spoken });
              _setSpeakingState(SPEAKING_STATE.IDLE);
            } else {
              await processGroqTurn(spoken);
            }
          }
        }
      }
    };

    rec.onstop = async () => {
      mediaRecRef.current = null;
      if (!chunks.length || !isMounted.current) return;
      const blob = new Blob(chunks, { type: 'audio/webm' });
      chunks = [];
      const { text, error } = await transcribeAudio(blob);
      if (!error && text?.trim() && isMounted.current) {
        if (disableAutoLLM) {
          _addTranscriptEntry({ speaker: 'Candidate', text: text.trim() });
          _setSpeakingState(SPEAKING_STATE.IDLE);
        } else {
          await processGroqTurn(text.trim());
        }
      }
    };

    rec.start(1000); // 1s timeslices
    mediaRecRef.current = rec;
    setIsMicOn(true);
    isMicOnRef.current = true;
    if (speakingStateRef.current !== SPEAKING_STATE.AI_SPEAKING) {
      _setSpeakingState(SPEAKING_STATE.IDLE);
    }
  }, [_ensureMicStreamAndAnalyser, disableAutoLLM, processGroqTurn, onError]);

  // ── Public Controls ─────────────────────────────────────────────────────────

  /** Init voice engine — sets engine to GEMINI_LIVE (Groq TTS mode). */
  const init = useCallback(async () => {
    if (engine !== ENGINE.NONE) return; // already initialised
    setIsInitialising(true);
    // We use Groq LLM + Gemini TTS — mark engine as active immediately
    setEngine(ENGINE.GEMINI_LIVE);
    setEvaluatorEngine('AUTO');
    setIsInitialising(false);
    console.info('[useVoiceInterviewer] Voice engine ready: Gemini TTS + Groq LLM + webkitSpeechRecognition');
  }, [engine]);

  /** Stop all audio and mic, disconnect everything. */
  const shutdown = useCallback(() => {
    _stopMicLevelPoll();
    _stopSpeechRec();
    _stopMediaRec();
    ttsCancel();
    groqAbort.current?.abort();
    whisperAbort.current?.abort();
    isMicOnRef.current = false;
    setEngine(ENGINE.NONE);
    setIsMicOn(false);
    setSpeakingState(SPEAKING_STATE.IDLE);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Start microphone. Auto-inits engine first if needed. */
  const startMic = useCallback(async () => {
    if (audioCtxRef.current?.state === 'suspended') {
      try { await audioCtxRef.current.resume(); } catch {}
    }
    if (engine === ENGINE.NONE) await init();

    const started = startSpeechRecognition();
    if (!started) {
      console.info('[useVoiceInterviewer] webkitSpeechRecognition not available, using Whisper fallback.');
      await startWhisperMic();
    }
  }, [engine, init, startSpeechRecognition, startWhisperMic]);

  /** Stop microphone. */
  const stopMic = useCallback(() => {
    isMicOnRef.current = false;
    _stopSpeechRec();
    _stopMediaRec();
    _stopMicLevelPoll();
    analyserRef.current = null;
    setIsMicOn(false);
    _setSpeakingState(SPEAKING_STATE.IDLE);
  }, []);

  /** Toggle microphone on/off. */
  const toggleMic = useCallback(async () => {
    if (isMicOn) {
      stopMic();
    } else {
      await startMic();
    }
  }, [isMicOn, startMic, stopMic]);

  /** Send candidate text into the Groq LLM pipeline (used for text input mode). */
  const sendText = useCallback(async (text) => {
    if (!text?.trim()) return;
    await processGroqTurn(text.trim());
  }, [processGroqTurn]);

  /** Toggle TTS mute. */
  const toggleTTS = useCallback(() => {
    setIsTTSOn(prev => {
      if (prev) ttsCancel();
      return !prev;
    });
  }, []);

  /**
   * Dedicated question delivery:
   * Disables mic during speech to avoid speaker feedback,
   * reads question aloud with TTS, and automatically arms the mic on completion.
   */
  const askQuestion = useCallback(async (questionText, onFinished) => {
    if (!questionText?.trim() || !isMounted.current) return;
    isDeliveringQuestionRef.current = true;
    _stopSpeechRec();
    _addTranscriptEntry({ speaker: 'AI', text: questionText });
    groqHistory.current.push({ role: 'assistant', content: questionText });

    await speak(questionText, () => {
      isDeliveringQuestionRef.current = false;
      if (isMounted.current) {
        startSpeechRecognition();
      }
      onFinished?.();
    });
  }, [speak, startSpeechRecognition]);

  /**
   * Speak an initial AI greeting.
   * Adds to transcript + plays TTS.
   */
  const greet = useCallback(async (greeting, onEnd) => {
    if (!greeting?.trim()) return;
    await askQuestion(greeting, onEnd);
  }, [askQuestion]);

  /** Force fallback mode (for testing Groq fallback). */
  const forceFallback = useCallback(() => {
    setEngine(ENGINE.GROQ_FALLBACK);
    setEvaluatorEngine('BACKUP_MODE');
    console.info('[useVoiceInterviewer] Engine switched to Groq Fallback Mode (Testing)');
  }, []);

  /** Force Gemini mode (for testing Gemini primary). */
  const forceGemini = useCallback(async () => {
    setEngine(ENGINE.GEMINI_LIVE);
    setEvaluatorEngine('GEMINI');
    console.info('[useVoiceInterviewer] Engine switched to Gemini Primary Mode (Testing)');
  }, []);

  /** Explicitly submit whatever candidate has spoken so far without waiting for silence timer */
  const submitCurrentSpeech = useCallback(async () => {
    await _finalizeUtterance();
  }, [_finalizeUtterance]);

  return {
    engine,
    speakingState,
    isInitialising,
    isMicOn,
    isTTSOn,
    micLevel,
    transcript,
    interimText,
    submitCurrentSpeech,
    isGeminiLive:   engine === ENGINE.GEMINI_LIVE,
    isGroqFallback: engine === ENGINE.GROQ_FALLBACK,
    // Controls
    init,
    shutdown,
    startMic,
    stopMic,
    toggleMic,
    sendText,
    toggleTTS,
    greet,
    askQuestion,
    forceFallback,
    forceGemini,
    // Expose speak directly for Phase 2 speakText delegation
    speak,
  };
}
