/**
 * ttsService.js – Production AI Text-to-Speech Engine for MockPro
 *
 * Engine cascade:
 *   PRIMARY:  Gemini TTS Multi-Model Cascade
 *             1. gemini-3.8-flash-lite-tts (native WAV, fast, high quota)
 *             2. gemini-3.1-flash-tts-preview (PCM L16 -> wrapped to WAV)
 *             3. gemini-2.5-flash-preview-tts (PCM L16 -> wrapped to WAV)
 *             4. gemini-3.8-flash-tts (native WAV)
 *             → Played via HTMLAudioElement (blob URL)
 *             → Automatic user-gesture autoplay unlock listener
 *
 *   FALLBACK: Web Speech API (window.speechSynthesis)
 *             → High-quality natural English voice selection
 *             → Auto-recovery from Chrome speech engine pause bug
 *
 * Features:
 *   • True barge-in: cancellation tokens prevent race conditions
 *   • PCM to WAV header injection for raw audio streams
 *   • Autoplay unlock: if play() is delayed by browser policy, unlocks on first click
 *   • Zero external audio library dependencies
 */

// ─── Key Resolution ───────────────────────────────────────────────────────────

function resolveGeminiKey() {
  try {
    const stored = JSON.parse(localStorage.getItem('mockpro_api_keys') ?? '{}');
    if (stored?.geminiApiKey?.trim()) return stored.geminiApiKey.trim();
  } catch { /* silent */ }
  return (import.meta.env.VITE_GEMINI_API_KEY ?? '').trim();
}

// ─── Active audio tracking ────────────────────────────────────────────────────

let _currentAudio            = null; // HTMLAudioElement or null
let _currentBlobUrl          = null; // Object URL to clean up
let _speakToken              = 0;    // Increments on every speak() AND cancel() call
let _pendingAudio            = null; // Audio queued waiting for user gesture unlock
let _activeAbortCtrl         = null; // Active fetch AbortController for Gemini TTS
let _activeResumeTimer       = null; // Active Web Speech resume interval
let _pendingWebSpeechTimeout = null; // Active setTimeout for Web Speech voices changed
let _activeUnlockHandler     = null; // Active user gesture unlock event listener

/** Stop any currently playing audio immediately (barge-in / reset). */
function stopCurrentAudio() {
  // Invalidate any in-flight async operations immediately
  _speakToken++;

  // Abort active Gemini TTS fetch immediately
  if (_activeAbortCtrl) {
    try { _activeAbortCtrl.abort(); } catch {}
    _activeAbortCtrl = null;
  }

  // Clear scheduled Web Speech timers
  if (_pendingWebSpeechTimeout) {
    clearTimeout(_pendingWebSpeechTimeout);
    _pendingWebSpeechTimeout = null;
  }
  if (_activeResumeTimer) {
    clearInterval(_activeResumeTimer);
    _activeResumeTimer = null;
  }

  // Remove any pending autoplay unlock listeners
  if (_activeUnlockHandler) {
    try {
      window.removeEventListener('click', _activeUnlockHandler, true);
      window.removeEventListener('keydown', _activeUnlockHandler, true);
      window.removeEventListener('pointerdown', _activeUnlockHandler, true);
    } catch {}
    _activeUnlockHandler = null;
  }
  _pendingAudio = null;

  // Instantly pause and clean HTMLAudioElement
  if (_currentAudio) {
    try {
      _currentAudio.onended = null;
      _currentAudio.onerror = null;
      _currentAudio.oncanplay = null;
      _currentAudio.pause();
      _currentAudio.currentTime = 0;
      _currentAudio.src = '';
    } catch { /* ignore */ }
    _currentAudio = null;
  }

  if (_currentBlobUrl) {
    try { URL.revokeObjectURL(_currentBlobUrl); } catch { /* ignore */ }
    _currentBlobUrl = null;
  }

  // Unconditionally cancel any Web Speech API speech
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = null;
      window.speechSynthesis.cancel();
    }
  } catch { /* ignore */ }

  ttsState.isSpeaking = false;
}

// ─── PCM to WAV Generator ─────────────────────────────────────────────────────

/**
 * Wraps raw 16-bit PCM samples in a standard 44-byte RIFF/WAVE header
 * so HTMLAudioElement can play it in any browser without WebAudio AudioContext.
 */
function pcmToWavBlob(pcmBytes, sampleRate = 24000, numChannels = 1) {
  const buffer = new ArrayBuffer(44 + pcmBytes.length);
  const view = new DataView(buffer);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.length, true); // Total file length - 8
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);                  // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);                   // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);         // Channels
  view.setUint32(24, sampleRate, true);          // SampleRate
  view.setUint32(28, sampleRate * numChannels * 2, true); // ByteRate
  view.setUint16(32, numChannels * 2, true);     // BlockAlign
  view.setUint16(34, 16, true);                  // BitsPerSample
  writeString(36, 'data');
  view.setUint32(40, pcmBytes.length, true);     // Data chunk length

  new Uint8Array(buffer, 44).set(pcmBytes);
  return new Blob([buffer], { type: 'audio/wav' });
}

// ─── Gemini TTS Engine ───────────────────────────────────────────────────────

const TTS_MODEL = 'gemini-2.0-flash';
let _ttsCooldownUntil = 0; // Cooldown timestamp when rate-limited or erroring

/**
 * Fetch speech audio from Gemini and play it via HTMLAudioElement.
 * Returns true if audio played or is queued for unlock; false to trigger Web Speech.
 */
async function speakViaGemini(text, onStart, onEnd, token) {
  const apiKey = resolveGeminiKey();
  if (!apiKey) return false;

  // If Gemini TTS recently rate-limited (HTTP 429 / 503), bypass network delay entirely
  if (Date.now() < _ttsCooldownUntil) {
    return false;
  }

  let audioBlob = null;
  if (token !== _speakToken) return true; // cancelled

  const abortCtrl = new AbortController();
  _activeAbortCtrl = abortCtrl;
  const timeoutId = setTimeout(() => abortCtrl.abort(), 2200); // 2.2s fast-abort

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortCtrl.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
            },
          },
        }),
      }
    );
    clearTimeout(timeoutId);
    if (_activeAbortCtrl === abortCtrl) _activeAbortCtrl = null;

    if (token !== _speakToken) return true; // cancelled during fetch

    if (!res.ok) {
      if (res.status === 429 || res.status === 503) {
        _ttsCooldownUntil = Date.now() + 45000; // 45s cooldown on quota/demand spikes
        console.warn(`[TTS] Gemini TTS ${res.status} (quota/demand limit). Cooling down for 45s, switching to instant Web Speech.`);
      } else {
        console.warn(`[TTS] ${TTS_MODEL} returned HTTP ${res.status}, falling back to Web Speech.`);
      }
      return false;
    }

    const data = await res.json();
    if (token !== _speakToken) return true; // cancelled during json parse

    const inlineData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inlineData?.data) {
      console.warn(`[TTS] ${TTS_MODEL} returned empty audio data`);
      return false;
    }

    // Decode base64 bytes
    const raw = atob(inlineData.data);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    // Check if it already has RIFF/WAVE header
    const isRiff = bytes.length > 4 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;

    if (isRiff) {
      audioBlob = new Blob([bytes], { type: 'audio/wav' });
    } else {
      const rateMatch = (inlineData.mimeType || '').match(/rate=(\d+)/i);
      const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
      audioBlob = pcmToWavBlob(bytes, sampleRate, 1);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (_activeAbortCtrl === abortCtrl) _activeAbortCtrl = null;
    if (token !== _speakToken) return true; // cancelled

    if (err.name === 'AbortError') {
      console.info('[TTS] Gemini TTS timed out or aborted (>2.2s). Seamlessly using instant Web Speech.');
    } else {
      console.warn('[TTS] Gemini TTS fetch exception:', err.message);
    }
    return false;
  }

  if (!audioBlob || token !== _speakToken) {
    return false;
  }

  const blobUrl = URL.createObjectURL(audioBlob);
  _currentBlobUrl = blobUrl;

  const audio = new Audio();
  _currentAudio = audio;

  audio.onended = () => {
    if (_currentBlobUrl === blobUrl) {
      try { URL.revokeObjectURL(blobUrl); } catch {}
      _currentBlobUrl = null;
    }
    if (_currentAudio === audio) _currentAudio = null;
    if (token === _speakToken) {
      ttsState.isSpeaking = false;
      onEnd?.();
    }
  };

  audio.onerror = (e) => {
    console.warn('[TTS] HTMLAudio playback error:', e.type, audio.error?.code, audio.error?.message);
    if (_currentBlobUrl === blobUrl) {
      try { URL.revokeObjectURL(blobUrl); } catch {}
      _currentBlobUrl = null;
    }
    if (_currentAudio === audio) _currentAudio = null;
    if (token === _speakToken) {
      ttsState.isSpeaking = false;
      onEnd?.();
    }
  };

  audio.src = blobUrl;

  try {
    if (token !== _speakToken) {
      try { URL.revokeObjectURL(blobUrl); } catch {}
      return true;
    }
    onStart?.();
    await audio.play();
    console.info(`[TTS] Playing via ${TTS_MODEL}: "${text.slice(0, 60)}..."`);
    return true;
  } catch (playErr) {
    if (token !== _speakToken) return true;

    // Check for Autoplay policy restriction (NotAllowedError)
    if (playErr.name === 'NotAllowedError') {
      console.warn('[TTS] Autoplay blocked by browser. Queued to play on first user click/interaction.');
      _pendingAudio = audio;

      const unlockHandler = () => {
        if (_pendingAudio === audio && token === _speakToken) {
          audio.play().then(() => {
            console.info('[TTS] Autoplay unlocked on user interaction!');
          }).catch(() => {});
        }
        try {
          window.removeEventListener('click', unlockHandler, true);
          window.removeEventListener('keydown', unlockHandler, true);
          window.removeEventListener('pointerdown', unlockHandler, true);
        } catch {}
        if (_activeUnlockHandler === unlockHandler) _activeUnlockHandler = null;
      };

      _activeUnlockHandler = unlockHandler;
      window.addEventListener('click', unlockHandler, true);
      window.addEventListener('keydown', unlockHandler, true);
      window.addEventListener('pointerdown', unlockHandler, true);

      // Return true because the Gemini audio is ready and will play upon interaction
      return true;
    }

    if (playErr.name === 'AbortError' || playErr.message?.includes('interrupted')) {
      console.info('[TTS] HTMLAudio.play was interrupted/superseded.');
      if (_currentBlobUrl === blobUrl) {
        try { URL.revokeObjectURL(blobUrl); } catch {}
        _currentBlobUrl = null;
      }
      if (_currentAudio === audio) _currentAudio = null;
      return true; // Intentionally stopped; do not trigger Web Speech fallback
    }

    console.warn('[TTS] HTMLAudio.play() error:', playErr.message);
    if (_currentBlobUrl === blobUrl) {
      try { URL.revokeObjectURL(blobUrl); } catch {}
      _currentBlobUrl = null;
    }
    if (_currentAudio === audio) _currentAudio = null;
    return false;
  }
}

// ─── Web Speech API Fallback ──────────────────────────────────────────────────

/**
 * Speak text using browser Web Speech API.
 */
function speakViaWebSpeech(text, onStart, onEnd, token) {
  if (token !== _speakToken) return;

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    console.warn('[TTS] Web Speech API not available in this browser.');
    onEnd?.();
    return;
  }

  try {
    window.speechSynthesis.onvoiceschanged = null;
    window.speechSynthesis.cancel();
  } catch {}

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate   = 1.0;
  utter.pitch  = 1.0;
  utter.volume = 1.0;
  utter.lang   = 'en-IN';

  let hasStarted = false;
  utter.onstart = () => {
    if (token !== _speakToken) {
      try { window.speechSynthesis.cancel(); } catch {}
      return;
    }
    hasStarted = true;
    console.info('[TTS] Web Speech playing.');
    onStart?.();
  };

  utter.onend = () => {
    if (_activeResumeTimer) {
      clearInterval(_activeResumeTimer);
      _activeResumeTimer = null;
    }
    if (token === _speakToken) {
      ttsState.isSpeaking = false;
      onEnd?.();
    }
  };

  utter.onerror = (e) => {
    if (_activeResumeTimer) {
      clearInterval(_activeResumeTimer);
      _activeResumeTimer = null;
    }
    if (e.error !== 'interrupted' && e.error !== 'canceled') {
      console.warn('[TTS] Web Speech error:', e.error);
    }
    if (token === _speakToken) {
      ttsState.isSpeaking = false;
      onEnd?.();
    }
  };

  function doSpeak() {
    if (token !== _speakToken) return;

    const voices = window.speechSynthesis.getVoices();

    // Prioritize authentic Indian English (en-IN) voices (Google English India, Microsoft Heera/Neerja/Ravi/Prabhat)
    const indianVoice = voices.find(v => {
      const lang = (v.lang || '').replace('_', '-').toLowerCase();
      const name = (v.name || '').toLowerCase();
      return (
        lang === 'en-in' ||
        name.includes('india') ||
        name.includes('indian') ||
        name.includes('heera') ||
        name.includes('neerja') ||
        name.includes('ravi') ||
        name.includes('prabhat')
      );
    });

    const pref =
      indianVoice ??
      voices.find(v => v.name.toLowerCase().includes('google') && v.lang.startsWith('en')) ??
      voices.find(v => (v.name.includes('Natural') || v.name.includes('Jenny') || v.name.includes('Guy')) && v.lang.startsWith('en')) ??
      voices.find(v => v.lang.startsWith('en')) ??
      voices[0];

    if (pref) {
      utter.voice = pref;
      utter.lang = pref.lang || 'en-IN';
      console.info(`[TTS] Speaking with voice: "${pref.name}" (${pref.lang})`);
    }

    if (token !== _speakToken) return;

    try {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel();
        setTimeout(() => {
          if (token === _speakToken) {
            window.speechSynthesis.speak(utter);
            window.speechSynthesis.resume();
          }
        }, 50);
      } else {
        window.speechSynthesis.speak(utter);
        window.speechSynthesis.resume();
      }
    } catch (e) {
      console.warn('[TTS] speechSynthesis.speak error:', e);
      return;
    }

    // Chrome bug workaround: speechSynthesis pauses long utterances (>15s)
    if (_activeResumeTimer) clearInterval(_activeResumeTimer);
    _activeResumeTimer = setInterval(() => {
      if (token !== _speakToken || !('speechSynthesis' in window) || !window.speechSynthesis.speaking) {
        clearInterval(_activeResumeTimer);
        _activeResumeTimer = null;
      } else {
        window.speechSynthesis.resume();
      }
    }, 3000);
  }

  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    doSpeak();
  } else {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.onvoiceschanged = null;
      if (token === _speakToken) {
        doSpeak();
      }
    };
    if (_pendingWebSpeechTimeout) clearTimeout(_pendingWebSpeechTimeout);
    _pendingWebSpeechTimeout = setTimeout(() => {
      _pendingWebSpeechTimeout = null;
      if (token === _speakToken && !window.speechSynthesis.speaking && !hasStarted) {
        doSpeak();
      }
    }, 400);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const ttsState = { isSpeaking: false };

/**
 * Speak text using the best available engine.
 * Barge-in safe: automatically stops previous audio.
 */
export async function speak(text, { onStart, onEnd } = {}) {
  if (!text?.trim()) { onEnd?.(); return; }

  // Clean markdown tokens that sound weird when spoken aloud
  const clean = text
    .replace(/\[APPROVE_[A-Z_]+\]/g, '')
    .replace(/\*{1,3}/g, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/\n+/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!clean) { onEnd?.(); return; }

  // Barge-in: cancel active audio immediately
  stopCurrentAudio();

  const token = _speakToken; // stopCurrentAudio incremented _speakToken

  ttsState.isSpeaking = true;
  const wrappedOnEnd = () => {
    if (token === _speakToken) {
      ttsState.isSpeaking = false;
    }
    onEnd?.();
  };

  console.info(`[TTS] speak() -> "${clean.slice(0, 80)}"`);

  // Try Gemini Multi-Model Cascade
  const geminiOk = await speakViaGemini(clean, onStart, wrappedOnEnd, token);
  if (geminiOk) return;

  // Fallback: Web Speech API
  if (token !== _speakToken) return;
  console.info('[TTS] -> Falling back to Web Speech API');
  speakViaWebSpeech(clean, onStart, wrappedOnEnd, token);
}

/** Cancel any ongoing speech immediately. */
export function cancel() {
  console.info('[TTS] cancel() called — stopping all speech and resetting tokens.');
  stopCurrentAudio();
}

export default { speak, cancel, ttsState };
