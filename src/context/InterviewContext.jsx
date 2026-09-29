/**
 * InterviewContext.jsx – Global state engine for MOCK PRO.
 *
 * Provides a React Context + Reducer pattern with:
 *  - Optimistic UI updates
 *  - Automatic localStorage sync on every state change
 *  - Hydration from storage on first render
 *  - Target company selection support
 *  - Ctrl+Shift+D emergency demo override
 */

import { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import {
  getSession,
  saveSession,
  getTranscripts,
  saveTranscripts,
  getCode,
  saveCode,
  getScorecard,
  saveScorecard,
  getPhase2State,
  savePhase2State,
  getAptitudeState,
  saveAptitudeState,
  clearSession as storageClear,
  seedMockData,
} from '../utils/storage';
import { cancel as ttsCancel } from '../services/ttsService';

// ─── Phase Constants ──────────────────────────────────────────────────────────
export const PHASES = {
  SETUP:      0,
  APTITUDE:   1,
  CODING:     2,
  HR:         3,
  VOICE:      3, // backwards-compatibility alias
  SCORECARD:  4,
};

export const PHASE_LABELS = ['Setup', 'Aptitude', 'Coding IDE', 'HR Round', 'Scorecard'];

// ─── Target Company Options ───────────────────────────────────────────────────
export const TARGET_COMPANIES = [
  'Google', 'Meta', 'Amazon', 'Microsoft', 'Apple', 'Uber', 'Netflix',
];

// ─── Initial State ────────────────────────────────────────────────────────────
function buildInitialState() {
  const session       = getSession();
  const transcripts   = getTranscripts();
  const codeState     = getCode();
  const scorecard     = getScorecard();
  const phase2State   = getPhase2State() ?? session.phase2State ?? null;
  const aptitudeState = getAptitudeState() ?? null;

  return {
    currentPhase: session.currentPhase ?? PHASES.SETUP,
    candidateData: session.candidateData ?? {
      resumeText:    '',
      parsedSkills:  [],
      targetJD:      '',
      parsedProfile: null,
      targetCompany: null,
    },
    codeState: {
      language:         codeState.language         ?? 'python',
      sourceCode:       codeState.sourceCode       ?? '',
      executionOutputs: codeState.executionOutputs ?? [],
    },
    phase2State,
    aptitudeState,
    transcriptHistory: Array.isArray(transcripts) ? transcripts : [],
    scorecard:         scorecard ?? null,
    aptitudeResults:   session.aptitudeResults ?? null,
    isLoading: false,
    error: null,
  };
}

// ─── Action Types ─────────────────────────────────────────────────────────────
export const ACTION = {
  SET_PHASE:             'SET_PHASE',
  UPDATE_CANDIDATE:      'UPDATE_CANDIDATE',
  UPDATE_CODE:           'UPDATE_CODE',
  UPDATE_PHASE2_STATE:   'UPDATE_PHASE2_STATE',
  UPDATE_APTITUDE_STATE: 'UPDATE_APTITUDE_STATE',
  APPEND_TRANSCRIPT:     'APPEND_TRANSCRIPT',
  SET_SCORECARD:         'SET_SCORECARD',
  SET_APTITUDE_RESULTS:  'SET_APTITUDE_RESULTS',
  SET_LOADING:           'SET_LOADING',
  SET_ERROR:             'SET_ERROR',
  RESET:                 'RESET',
  HYDRATE:               'HYDRATE',
};

// ─── Reducer ──────────────────────────────────────────────────────────────────
function interviewReducer(state, action) {
  switch (action.type) {
    case ACTION.SET_PHASE:
      return { ...state, currentPhase: action.payload, error: null };

    case ACTION.UPDATE_CANDIDATE:
      return {
        ...state,
        candidateData: { ...state.candidateData, ...action.payload },
      };

    case ACTION.UPDATE_CODE:
      return {
        ...state,
        codeState: { ...state.codeState, ...action.payload },
      };

    case ACTION.UPDATE_PHASE2_STATE:
      return {
        ...state,
        phase2State: { ...(state.phase2State || {}), ...action.payload },
      };

    case ACTION.UPDATE_APTITUDE_STATE:
      return {
        ...state,
        aptitudeState: { ...(state.aptitudeState || {}), ...action.payload },
      };

    case ACTION.APPEND_TRANSCRIPT: {
      const entry = {
        speaker: action.payload.speaker,
        text:    action.payload.text,
        phase:   action.payload.phase ?? state.currentPhase,
        ts:      action.payload.ts    ?? Date.now(),
      };
      return {
        ...state,
        transcriptHistory: [...state.transcriptHistory, entry],
      };
    }

    case ACTION.SET_SCORECARD:
      return { ...state, scorecard: action.payload };

    case ACTION.SET_APTITUDE_RESULTS:
      return { ...state, aptitudeResults: action.payload };

    case ACTION.SET_LOADING:
      return { ...state, isLoading: action.payload };

    case ACTION.SET_ERROR:
      return { ...state, error: action.payload, isLoading: false };

    case ACTION.RESET:
      ttsCancel();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch {}
      }
      storageClear();
      return buildInitialState();

    case ACTION.HYDRATE:
      return { ...state, ...action.payload };

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────
const InterviewContext = createContext(null);

export function InterviewProvider({ children }) {
  const [state, dispatch] = useReducer(interviewReducer, null, buildInitialState);

  // ── Persist to localStorage on every relevant state change ──
  useEffect(() => {
    saveSession({
      currentPhase:    state.currentPhase,
      candidateData:   state.candidateData,
      aptitudeResults: state.aptitudeResults,
      phase2State:     state.phase2State,
    });
  }, [state.currentPhase, state.candidateData, state.aptitudeResults, state.phase2State]);

  useEffect(() => {
    saveTranscripts(state.transcriptHistory);
  }, [state.transcriptHistory]);

  useEffect(() => {
    saveCode(state.codeState);
  }, [state.codeState]);

  useEffect(() => {
    if (state.scorecard !== null) {
      saveScorecard(state.scorecard);
    }
  }, [state.scorecard]);

  useEffect(() => {
    if (state.phase2State !== null) {
      savePhase2State(state.phase2State);
    }
  }, [state.phase2State]);

  useEffect(() => {
    if (state.aptitudeState !== null) {
      saveAptitudeState(state.aptitudeState);
    }
  }, [state.aptitudeState]);

  // ── Ctrl+Shift+D – seed mock data & jump to Phase 2 ──────────────
  useEffect(() => {
    function handleHotkey(e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        const mocked = seedMockData();
        dispatch({
          type: ACTION.HYDRATE,
          payload: {
            currentPhase:      mocked.session.currentPhase,
            candidateData:     mocked.session.candidateData,
            aptitudeResults:   mocked.session.aptitudeResults,
            transcriptHistory: mocked.transcripts,
            codeState:         mocked.code,
          },
        });
        console.info('[InterviewContext] Mock data loaded via Ctrl+Shift+D → Phase 2 (Target: Meta).');
      }
    }
    window.addEventListener('keydown', handleHotkey);
    return () => window.removeEventListener('keydown', handleHotkey);
  }, []);

  // ── Convenience action creators ─────────────────────────────────
  const setPhase            = useCallback((phase) => dispatch({ type: ACTION.SET_PHASE, payload: phase }), []);
  const updateCandidate     = useCallback((data)  => dispatch({ type: ACTION.UPDATE_CANDIDATE, payload: data }), []);
  const updateCode          = useCallback((data)  => dispatch({ type: ACTION.UPDATE_CODE, payload: data }), []);
  const updatePhase2State   = useCallback((data)  => dispatch({ type: ACTION.UPDATE_PHASE2_STATE, payload: data }), []);
  const updateAptitudeState = useCallback((data)  => dispatch({ type: ACTION.UPDATE_APTITUDE_STATE, payload: data }), []);
  const appendTranscript    = useCallback((entry) => dispatch({ type: ACTION.APPEND_TRANSCRIPT, payload: entry }), []);
  const setScorecard        = useCallback((card)  => dispatch({ type: ACTION.SET_SCORECARD, payload: card }), []);
  const setAptitudeResults  = useCallback((res)   => dispatch({ type: ACTION.SET_APTITUDE_RESULTS, payload: res }), []);
  const setLoading          = useCallback((bool)  => dispatch({ type: ACTION.SET_LOADING, payload: bool }), []);
  const setError            = useCallback((msg)   => dispatch({ type: ACTION.SET_ERROR, payload: msg }), []);
  const resetInterview      = useCallback(() => {
    ttsCancel();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch {}
    }
    dispatch({ type: ACTION.RESET });
  }, []);

  const value = {
    // State
    ...state,
    // Action creators
    setPhase,
    updateCandidate,
    updateCode,
    updatePhase2State,
    updateAptitudeState,
    appendTranscript,
    setScorecard,
    setAptitudeResults,
    setLoading,
    setError,
    resetInterview,
    dispatch,
  };

  return (
    <InterviewContext.Provider value={value}>
      {children}
    </InterviewContext.Provider>
  );
}

/**
 * useInterview – Hook to consume the InterviewContext.
 * Throws if used outside of <InterviewProvider>.
 */
export function useInterview() {
  const ctx = useContext(InterviewContext);
  if (!ctx) {
    throw new Error('useInterview must be used within an <InterviewProvider>.');
  }
  return ctx;
}

export default InterviewContext;
