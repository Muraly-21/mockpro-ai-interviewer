/**
 * useSilenceTimer.js – Silence & Inactivity Monitor for Company Standard Interviews.
 *
 * Used in:
 *  - Phase 2: Technical Coding Round (Socratic IDE)
 *  - Phase 3: HR Round (Self Intro, Technical Project & STAR Behavioral)
 *
 * If candidate is inactive or silent for the threshold duration (default ~22s):
 *  → The AI interviewer politely speaks up with natural guidance, prompting them to answer.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { speak as ttsspeak, cancel as ttsCancel } from '../services/ttsService';

const DEFAULT_SILENCE_THRESHOLD_MS = 22_000; // 22 seconds

const DEFAULT_PROMPTS = [
  'Take your time, but feel free to think out loud or walk me through your approach.',
  'Please feel free to share your thought process or any questions you have.',
  'Whenever you are ready, please go ahead and explain your reasoning.',
  'I am listening, feel free to elaborate on your project or solution.',
];

/**
 * useSilenceTimer
 *
 * Accepts either:
 *   useSilenceTimer(fsmState) -> backward-compatible for FSM
 * OR
 *   useSilenceTimer({ active, thresholdMs, prompts, onPromptFired })
 */
export default function useSilenceTimer(options) {
  // Normalize options
  let active = true;
  let thresholdMs = DEFAULT_SILENCE_THRESHOLD_MS;
  let customPrompts = DEFAULT_PROMPTS;
  let onPromptFired = null;

  if (typeof options === 'string') {
    // Legacy call: options is fsmState
    // Active during active problem solving / coding
    active = Boolean(options);
    thresholdMs = 28_000;
  } else if (typeof options === 'object' && options !== null) {
    if (typeof options.active === 'boolean') active = options.active;
    if (typeof options.thresholdMs === 'number') thresholdMs = options.thresholdMs;
    if (Array.isArray(options.prompts)) customPrompts = options.prompts;
    if (typeof options.onPromptFired === 'function') onPromptFired = options.onPromptFired;
  }

  const [isSilenceWarningActive, setIsSilenceWarningActive] = useState(false);
  const timerRef = useRef(null);
  const promptIdxRef = useRef(0);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  /**
   * Fire silence prompt through unified TTS engine.
   */
  const fireSilencePrompt = useCallback(async () => {
    if (!isMounted.current || !active) return;
    setIsSilenceWarningActive(true);

    const promptsList = customPrompts.length > 0 ? customPrompts : DEFAULT_PROMPTS;
    const promptText = promptsList[promptIdxRef.current % promptsList.length];
    promptIdxRef.current += 1;

    console.info('[SilenceTimer] Inactivity detected, prompting candidate:', promptText);
    onPromptFired?.(promptText);

    try {
      await ttsspeak(promptText, {
        onEnd: () => {
          if (isMounted.current) {
            setIsSilenceWarningActive(false);
            // Stagger next prompt if still silent
            if (active) {
              timerRef.current = setTimeout(fireSilencePrompt, thresholdMs * 1.5);
            }
          }
        },
      });
    } catch {
      if (isMounted.current) {
        setTimeout(() => setIsSilenceWarningActive(false), 3000);
      }
    }
  }, [active, customPrompts, onPromptFired, thresholdMs]);

  /**
   * Start or restart the silence countdown.
   */
  const startTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!active) return;
    timerRef.current = setTimeout(fireSilencePrompt, thresholdMs);
  }, [active, fireSilencePrompt, thresholdMs]);

  /**
   * Reset the timer – call whenever candidate speaks or types.
   */
  const resetSilenceTimer = useCallback(() => {
    if (isMounted.current) setIsSilenceWarningActive(false);
    if (active) {
      startTimer();
    }
  }, [active, startTimer]);

  // ── Sync with active prop ──
  useEffect(() => {
    if (active) {
      startTimer();
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setIsSilenceWarningActive(false);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [active, startTimer]);

  return {
    resetSilenceTimer,
    isSilenceWarningActive,
  };
}
