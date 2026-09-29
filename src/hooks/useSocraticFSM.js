/**
 * useSocraticFSM.js – 4-State Socratic Finite State Machine for Phase 2.
 *
 * States (per question):
 *   CLARIFICATION → APPROACH → CODING → INTERROGATION
 *
 * Editor is readOnly in every state except CODING.
 *
 * Transition Methods (two paths, same FSM):
 *   1. handleToolCall(name, args) – PRIMARY: triggered by Gemini Function Calling
 *      tool events (approve_clarification, approve_approach, trigger_code_review).
 *      Deterministic. No string parsing.
 *   2. processGateResponse(response) – FALLBACK: triggered by Groq REST evaluator
 *      token strings ([APPROVE_CLARIFICATION], [APPROVE_APPROACH]).
 *      Used when Gemini Live is not connected.
 *
 * Supports 2-question pipeline:
 *   Question 1 → full FSM cycle → Question 2 → full FSM cycle → Done
 *
 * Presenter Emergency Controls:
 *   forceUnlockEditor() – bypass readOnly lock without changing FSM state
 *   forceTransition(state) – jump to any FSM state for demo purposes
 */

import { useState, useCallback, useMemo } from 'react';

// ─── FSM State Constants ────────────────────────────────────────────────────
export const FSM_STATES = {
  CLARIFICATION:  'PHASE2_STATE_CLARIFICATION',
  APPROACH:       'PHASE2_STATE_APPROACH',
  CODING:         'PHASE2_STATE_CODING',
  INTERROGATION:  'PHASE2_STATE_INTERROGATION',
};

// ─── Gate Tokens ────────────────────────────────────────────────────────────
export const GATE_TOKENS = {
  APPROVE_CLARIFICATION: '[APPROVE_CLARIFICATION]',
  APPROVE_APPROACH:      '[APPROVE_APPROACH]',
};

// ─── Ordered State List (for progress display) ──────────────────────────────
export const FSM_STATE_ORDER = [
  FSM_STATES.CLARIFICATION,
  FSM_STATES.APPROACH,
  FSM_STATES.CODING,
  FSM_STATES.INTERROGATION,
];

export const FSM_STATE_LABELS = {
  [FSM_STATES.CLARIFICATION]:  'Clarification',
  [FSM_STATES.APPROACH]:       'Approach Discussion',
  [FSM_STATES.CODING]:         'Coding',
  [FSM_STATES.INTERROGATION]:  'Code Review',
};

// ─── States where editor is locked ──────────────────────────────────────────
const LOCKED_STATES = new Set([
  FSM_STATES.CLARIFICATION,
  FSM_STATES.APPROACH,
  FSM_STATES.INTERROGATION,
]);

// ─── Question Pipeline Constants ────────────────────────────────────────────
export const TOTAL_QUESTIONS = 2;

/**
 * useSocraticFSM – Hook providing deterministic FSM state management
 * with 2-question pipeline support and presenter emergency controls.
 *
 * @param {string|Object} [initialConfig] – Optional override for initial state or config object { fsmState, currentQuestion, isSessionComplete }
 * @returns {Object} FSM controls
 */
export default function useSocraticFSM(initialConfig = FSM_STATES.CLARIFICATION) {
  const initialState = typeof initialConfig === 'string'
    ? initialConfig
    : (initialConfig?.fsmState || FSM_STATES.CLARIFICATION);
  const initialQuestion = typeof initialConfig === 'object' && initialConfig?.currentQuestion
    ? initialConfig.currentQuestion
    : 1;
  const initialComplete = typeof initialConfig === 'object' && initialConfig?.isSessionComplete
    ? initialConfig.isSessionComplete
    : false;

  const [fsmState, setFsmState]                   = useState(initialState);
  const [currentQuestion, setCurrentQuestion]     = useState(initialQuestion); // 1 or 2
  const [isSessionComplete, setIsSessionComplete] = useState(initialComplete);
  const [isManualOverride, setIsManualOverride]   = useState(false);

  /** Whether the Monaco editor should be readOnly — respects presenter override */
  const isEditorLocked = useMemo(
    () => isManualOverride ? false : LOCKED_STATES.has(fsmState),
    [fsmState, isManualOverride],
  );

  /** Current state index for progress display (0-3) */
  const stateIndex = useMemo(
    () => FSM_STATE_ORDER.indexOf(fsmState),
    [fsmState],
  );

  /**
   * Direct state transition — use sparingly (e.g. Ctrl+Shift+D emergency).
   */
  const transitionTo = useCallback((newState) => {
    if (FSM_STATE_ORDER.includes(newState)) {
      setFsmState(newState);
      setIsManualOverride(false);
      console.info(`[FSM] Direct transition → ${newState}`);
    } else {
      console.warn(`[FSM] Invalid state: ${newState}`);
    }
  }, []);

  /**
   * Process a Groq evaluator response and auto-advance FSM if gate token matches.
   *
   * @param {{ approved: boolean, gateToken: string|null, feedbackPrompt: string }} response
   * @returns {{ transitioned: boolean, newState: string }}
   */
  const processGateResponse = useCallback((response) => {
    const { gateToken } = response ?? {};

    // CLARIFICATION → APPROACH
    if (
      fsmState === FSM_STATES.CLARIFICATION &&
      gateToken === GATE_TOKENS.APPROVE_CLARIFICATION
    ) {
      setFsmState(FSM_STATES.APPROACH);
      setIsManualOverride(false);
      console.info('[FSM] Gate passed: CLARIFICATION → APPROACH');
      return { transitioned: true, newState: FSM_STATES.APPROACH };
    }

    // APPROACH → CODING
    if (
      fsmState === FSM_STATES.APPROACH &&
      gateToken === GATE_TOKENS.APPROVE_APPROACH
    ) {
      setFsmState(FSM_STATES.CODING);
      setIsManualOverride(false);
      console.info('[FSM] Gate passed: APPROACH → CODING (editor unlocked)');
      return { transitioned: true, newState: FSM_STATES.CODING };
    }

    return { transitioned: false, newState: fsmState };
  }, [fsmState]);

  /**
   * Submit code — transitions CODING → INTERROGATION (locks editor).
   */
  const submitCode = useCallback(() => {
    if (fsmState === FSM_STATES.CODING) {
      setFsmState(FSM_STATES.INTERROGATION);
      setIsManualOverride(false);
      console.info('[FSM] Code submitted → INTERROGATION (editor locked)');
      return true;
    }
    console.warn('[FSM] submitCode called outside CODING state, ignored.');
    return false;
  }, [fsmState]);

  /**
   * Advance to next question – resets FSM to CLARIFICATION for Q2.
   * Returns true if advanced, false if session is complete.
   */
  const advanceToNextQuestion = useCallback(() => {
    if (currentQuestion < TOTAL_QUESTIONS) {
      setCurrentQuestion(currentQuestion + 1);
      setFsmState(FSM_STATES.CLARIFICATION);
      setIsManualOverride(false);
      console.info(`[FSM] Advanced to Question ${currentQuestion + 1} → CLARIFICATION`);
      return true;
    }
    // Both questions complete
    setIsSessionComplete(true);
    console.info('[FSM] All questions complete. Session finished.');
    return false;
  }, [currentQuestion]);

  /**
   * Reset FSM to initial state (Question 1, CLARIFICATION).
   */
  const resetFSM = useCallback(() => {
    setFsmState(FSM_STATES.CLARIFICATION);
    setCurrentQuestion(1);
    setIsSessionComplete(false);
    setIsManualOverride(false);
    console.info('[FSM] Reset → Question 1, CLARIFICATION');
  }, []);

  /**
   * handleToolCall – PRIMARY transition path via Gemini Function Calling.
   *
   * Called when the Gemini Live service fires a tool call event instead of
   * emitting a raw text gate token. This is the deterministic, regex-free path.
   *
   * @param {string} toolName – One of: 'approve_clarification', 'approve_approach', 'trigger_code_review'
   * @param {Object} [args]   – Tool call arguments (e.g. { reason, timeComplexity, spaceComplexity })
   * @returns {{ transitioned: boolean, newState: string }}
   */
  const handleToolCall = useCallback((toolNameOrPayload, args = {}) => {
    let toolName = toolNameOrPayload;
    if (typeof toolNameOrPayload === 'object' && toolNameOrPayload !== null) {
      if (toolNameOrPayload.approved) {
        if (toolNameOrPayload.nextState === 'CODING' || toolNameOrPayload.nextState === FSM_STATES.CODING) {
          toolName = 'approve_approach';
        } else if (toolNameOrPayload.nextState === 'APPROACH' || toolNameOrPayload.nextState === FSM_STATES.APPROACH) {
          toolName = 'approve_clarification';
        }
      }
      if (toolNameOrPayload.name) {
        toolName = toolNameOrPayload.name;
        args = toolNameOrPayload.args ?? args;
      }
    }

    switch (toolName) {
      case 'approve_clarification':
        if (fsmState === FSM_STATES.CLARIFICATION) {
          setFsmState(FSM_STATES.APPROACH);
          setIsManualOverride(false);
          console.info('[FSM] Tool call: approve_clarification → APPROACH', args);
          return { transitioned: true, newState: FSM_STATES.APPROACH };
        }
        break;

      case 'approve_approach':
        if (fsmState === FSM_STATES.APPROACH) {
          setFsmState(FSM_STATES.CODING);
          setIsManualOverride(false);
          console.info('[FSM] Tool call: approve_approach → CODING (editor unlocked)', args);
          return { transitioned: true, newState: FSM_STATES.CODING };
        }
        break;

      case 'trigger_code_review':
        if (fsmState === FSM_STATES.CODING || fsmState === FSM_STATES.INTERROGATION) {
          setFsmState(FSM_STATES.INTERROGATION);
          setIsManualOverride(false);
          console.info('[FSM] Tool call: trigger_code_review → INTERROGATION', args);
          return { transitioned: true, newState: FSM_STATES.INTERROGATION };
        }
        break;

      default:
        console.warn(`[FSM] Unknown tool call: ${toolName}`);
    }
    return { transitioned: false, newState: fsmState };
  }, [fsmState]);

  /**
   * Presenter Emergency: Force-unlock the editor regardless of FSM state.
   * Does NOT change the FSM state — just bypasses the readOnly lock.
   */
  const forceUnlockEditor = useCallback(() => {
    setIsManualOverride(true);
    console.info('[FSM] Presenter override: Editor force-unlocked.');
  }, []);

  /**
   * Presenter Emergency: Force-transition to a specific FSM state.
   * Also clears any manual override.
   */
  const forceTransition = useCallback((targetState) => {
    if (FSM_STATE_ORDER.includes(targetState)) {
      setFsmState(targetState);
      setIsManualOverride(false);
      console.info(`[FSM] Presenter force-transition → ${targetState}`);
    }
  }, []);

  return {
    fsmState,
    isEditorLocked,
    isManualOverride,
    stateIndex,
    currentQuestion,
    totalQuestions: TOTAL_QUESTIONS,
    isSessionComplete,
    transitionTo,
    processGateResponse,
    handleToolCall,
    submitCode,
    advanceToNextQuestion,
    resetFSM,
    forceUnlockEditor,
    forceTransition,
  };
}
