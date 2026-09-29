/**
 * useGroqWhisper.js – Sub-second voice transcription (STT) via Groq Whisper.
 *
 * Continuously captures audio via MediaRecorder → posts 3-second PCM blobs
 * to Groq Whisper (whisper-large-v3-turbo) → returns text in <400ms.
 *
 * Features:
 *   - Real-time barge-in interruption: monitors mic levels while AI speaks,
 *     cancels TTS immediately when candidate speech detected.
 *   - Audio level monitoring via AnalyserNode for visual feedback.
 *   - Automatic voice activity detection (VAD) threshold.
 *
 * Usage:
 *   const { isListening, audioLevel, startListening, stopListening } = useGroqWhisper({
 *     onTranscript: (text) => handleSendMessage(text),
 *     silenceThreshold: 0.015,
 *   });
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { transcribeAudio } from '../services/groqService';

// ─── Constants ──────────────────────────────────────────────────────────────
const CHUNK_INTERVAL_MS     = 2000;   // Record in 2-second chunks for responsiveness
const BARGE_IN_THRESHOLD    = 0.008;  // RMS level to trigger barge-in (lowered for sensitivity)
const MIN_AUDIO_DURATION_MS = 300;    // Minimum chunk length to send

/**
 * useGroqWhisper – Real-time STT with barge-in support.
 *
 * @param {Object} opts
 * @param {(text: string) => void} opts.onTranscript  Callback when transcription arrives
 * @param {number} [opts.silenceThreshold]            Audio RMS threshold for activity
 * @returns {{ isListening: boolean, audioLevel: number, startListening: () => void, stopListening: () => void, voiceStatus: string }}
 */
export default function useGroqWhisper({
  onTranscript,
  silenceThreshold = BARGE_IN_THRESHOLD,
} = {}) {
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel]   = useState(0);
  const [voiceStatus, setVoiceStatus] = useState('idle'); // idle | listening | processing | ai_speaking

  const mediaRecorderRef = useRef(null);
  const audioContextRef  = useRef(null);
  const analyserRef      = useRef(null);
  const streamRef        = useRef(null);
  const chunksRef        = useRef([]);
  const intervalRef      = useRef(null);
  const animFrameRef     = useRef(null);
  const chunkStartRef    = useRef(0);

  // ── Audio Level Monitor ─────────────────────────────────────────
  const monitorAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;

    const analyser  = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      analyser.getByteTimeDomainData(dataArray);

      // Calculate RMS
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      setAudioLevel(rms);

      // ── Barge-in: interrupt TTS if candidate speaks ──
      if (rms > silenceThreshold && window.speechSynthesis?.speaking) {
        window.speechSynthesis.cancel();
        setVoiceStatus('listening');
        console.info('[Whisper] Barge-in detected – TTS cancelled');
      }

      animFrameRef.current = requestAnimationFrame(tick);
    }

    tick();
  }, [silenceThreshold]);

  // ── Process Audio Chunk ─────────────────────────────────────────
  const processChunk = useCallback(async () => {
    if (chunksRef.current.length === 0) return;

    const elapsed = Date.now() - chunkStartRef.current;
    if (elapsed < MIN_AUDIO_DURATION_MS) return;

    const blob = new Blob(chunksRef.current, { type: 'audio/webm;codecs=opus' });
    chunksRef.current = [];
    chunkStartRef.current = Date.now();

    // Skip very small blobs (likely silence) — 200 bytes is minimal threshold
    if (blob.size < 200) return;

    setVoiceStatus('processing');

    try {
      const { text, error } = await transcribeAudio(blob);

      if (error) {
        console.warn('[Whisper] Transcription error:', error);
        setVoiceStatus('listening');
        return;
      }

      const trimmed = text?.trim();
      if (trimmed && trimmed.length > 1) {
        onTranscript?.(trimmed);
      }
    } catch (err) {
      console.error('[Whisper] Processing error:', err);
    }

    setVoiceStatus('listening');
  }, [onTranscript]);

  // ── Start Listening ─────────────────────────────────────────────
  const startListening = useCallback(async () => {
    if (isListening) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl:  true,
          channelCount:     1,
        },
      });

      streamRef.current = stream;

      // Set up audio analysis for level monitoring & barge-in
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source   = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;   // Smaller fftSize = faster, more real-time level readings
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current     = analyser;

      // Set up MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        // Process any remaining chunks
        processChunk();
      };

      mediaRecorderRef.current = recorder;
      chunksRef.current        = [];
      chunkStartRef.current    = Date.now();

      recorder.start(100); // Collect data every 100ms
      setIsListening(true);
      setVoiceStatus('listening');

      // Start audio level monitoring
      monitorAudioLevel();

      // Set up chunk processing interval (every 3 seconds)
      intervalRef.current = setInterval(processChunk, CHUNK_INTERVAL_MS);

      console.info('[Whisper] Listening started');
    } catch (err) {
      console.error('[Whisper] Failed to start:', err);
      setVoiceStatus('idle');
    }
  }, [isListening, processChunk, monitorAudioLevel]);

  // ── Stop Listening ──────────────────────────────────────────────
  const stopListening = useCallback(() => {
    // Stop interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Stop animation frame
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    // Stop recorder
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    // Stop audio context
    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close().catch(() => {});
    }
    audioContextRef.current = null;
    analyserRef.current     = null;

    // Stop stream tracks
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    setIsListening(false);
    setAudioLevel(0);
    setVoiceStatus('idle');
    chunksRef.current = [];

    console.info('[Whisper] Listening stopped');
  }, []);

  // ── Update voiceStatus when TTS plays ───────────────────────────
  useEffect(() => {
    if (!isListening) return;

    const checkTTS = setInterval(() => {
      if (window.speechSynthesis?.speaking && voiceStatus !== 'ai_speaking') {
        setVoiceStatus('ai_speaking');
      } else if (!window.speechSynthesis?.speaking && voiceStatus === 'ai_speaking') {
        setVoiceStatus('listening');
      }
    }, 200);

    return () => clearInterval(checkTTS);
  }, [isListening, voiceStatus]);

  // ── Cleanup on unmount ──────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close().catch(() => {});
      }
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return {
    isListening,
    audioLevel,
    voiceStatus,
    startListening,
    stopListening,
  };
}
