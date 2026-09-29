/**
 * useGeminiLive.js – Dedicated Hook for Gemini Multimodal Live WebSocket API.
 *
 * Provides direct, low-latency, bidirectional voice streaming with:
 *  - 16kHz PCM downsampled microphone input with RMS noise gate (> 0.015)
 *  - 300ms continuous speech debounce for ambient noise rejection
 *  - Sub-second server barge-in with instantaneous audio queue flush
 *  - Deterministic Gemini Tool Calling (approve_clarification, approve_approach, trigger_code_review)
 *  - Browser gesture AudioContext resume guard
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import GeminiLiveClient, { resolveGeminiKey, GEMINI_LIVE_MODEL } from '../services/geminiLiveService';

export const SPEAKING_STATE = {
  IDLE:               'idle',
  AI_SPEAKING:        'ai-speaking',
  CANDIDATE_SPEAKING: 'candidate-speaking',
  PROCESSING:         'processing',
};

/**
 * useGeminiLive
 *
 * @param {Object} opts
 * @param {string}   opts.systemInstruction - Context & persona for Gemini Live
 * @param {Function} opts.onTranscript      - ({ speaker, text }) => void
 * @param {Function} opts.onToolCall        - ({ name, args }) => void
 * @param {Function} opts.onError           - (errorMsg) => void
 * @param {Function} opts.onSpeakingChange  - (speakingState) => void
 */
export default function useGeminiLive({
  systemInstruction = '',
  onTranscript,
  onToolCall,
  onError,
  onSpeakingChange,
} = {}) {
  const [isConnected, setIsConnected]       = useState(false);
  const [isConnecting, setIsConnecting]     = useState(false);
  const [isMicActive, setIsMicActive]       = useState(false);
  const [speakingState, setSpeakingState]   = useState(SPEAKING_STATE.IDLE);
  const [micLevel, setMicLevel]             = useState(0);

  const clientRef     = useRef(null);
  const micTimerRef   = useRef(null);
  const isMountedRef  = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (micTimerRef.current) clearInterval(micTimerRef.current);
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, []);

  const handleSpeakingStateChange = useCallback((state) => {
    if (!isMountedRef.current) return;
    setSpeakingState(state);
    onSpeakingChange?.(state);
  }, [onSpeakingChange]);

  const startLevelPolling = useCallback(() => {
    if (micTimerRef.current) return;
    micTimerRef.current = setInterval(() => {
      if (clientRef.current?.isConnected) {
        setMicLevel(clientRef.current.getMicLevel());
      }
    }, 50);
  }, []);

  const stopLevelPolling = useCallback(() => {
    if (micTimerRef.current) {
      clearInterval(micTimerRef.current);
      micTimerRef.current = null;
    }
    setMicLevel(0);
  }, []);

  /**
   * Connect to Gemini Live WebSocket.
   * Can be passed dynamic systemInstruction override.
   */
  const connect = useCallback(async (customInstruction = '') => {
    const key = resolveGeminiKey();
    if (!key) {
      onError?.('Gemini API key is not configured in settings or environment.');
      return false;
    }

    if (clientRef.current?.isConnected) {
      return true;
    }

    setIsConnecting(true);

    const client = new GeminiLiveClient({
      onTranscript: (entry) => {
        if (isMountedRef.current) onTranscript?.(entry);
      },
      onSpeakingStateChange: handleSpeakingStateChange,
      onError: (msg) => {
        if (isMountedRef.current) {
          setIsConnecting(false);
          onError?.(msg);
        }
      },
      onConnectionChange: (connected) => {
        if (isMountedRef.current) {
          setIsConnected(connected);
          setIsConnecting(false);
          if (!connected) {
            setIsMicActive(false);
            stopLevelPolling();
          }
        }
      },
      onToolCall: (call) => {
        console.info('[useGeminiLive] Received structured tool call:', call);
        onToolCall?.(call);
      },
    });

    clientRef.current = client;

    const instruction = customInstruction || systemInstruction;
    const success = await client.connect(instruction);

    if (isMountedRef.current) {
      setIsConnecting(false);
      setIsConnected(success);
    }

    return success;
  }, [systemInstruction, onTranscript, onToolCall, onError, handleSpeakingStateChange, stopLevelPolling]);

  /** Disconnect and tear down audio */
  const disconnect = useCallback(() => {
    stopLevelPolling();
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    if (isMountedRef.current) {
      setIsConnected(false);
      setIsConnecting(false);
      setIsMicActive(false);
      setSpeakingState(SPEAKING_STATE.IDLE);
    }
  }, [stopLevelPolling]);

  /** Start capturing microphone input */
  const startMic = useCallback(async () => {
    if (!clientRef.current?.isConnected) {
      const ok = await connect();
      if (!ok) return false;
    }

    try {
      await clientRef.current.startMic();
      if (isMountedRef.current) {
        setIsMicActive(true);
        startLevelPolling();
      }
      return true;
    } catch (err) {
      onError?.(err.message);
      return false;
    }
  }, [connect, onError, startLevelPolling]);

  /** Stop microphone capture */
  const stopMic = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.stopMic();
    }
    if (isMountedRef.current) {
      setIsMicActive(false);
      stopLevelPolling();
    }
  }, [stopLevelPolling]);

  /** Toggle microphone on/off */
  const toggleMic = useCallback(async () => {
    if (isMicActive) {
      stopMic();
      return false;
    } else {
      return await startMic();
    }
  }, [isMicActive, startMic, stopMic]);

  /** Send candidate text to the Gemini Live session */
  const sendText = useCallback((text) => {
    if (!text?.trim() || !clientRef.current?.isConnected) return;
    clientRef.current.sendText(text.trim());
  }, []);

  return {
    isConnected,
    isConnecting,
    isMicActive,
    speakingState,
    micLevel,
    isAiSpeaking: speakingState === SPEAKING_STATE.AI_SPEAKING,
    isCandidateSpeaking: speakingState === SPEAKING_STATE.CANDIDATE_SPEAKING,
    model: GEMINI_LIVE_MODEL,
    connect,
    disconnect,
    startMic,
    stopMic,
    toggleMic,
    sendText,
  };
}
