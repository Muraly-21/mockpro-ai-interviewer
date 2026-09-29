/**
 * AptitudePhase.jsx – Phase 1: Aptitude MCQ Engine (Module 2 – full implementation)
 *
 * Features:
 *  - Generates a 10-question quiz via Groq (weighted: resume/JD/CS fundamentals)
 *  - Per-question countdown timer (20 s) with auto-advance on timeout
 *  - Single-select interactive MCQ cards with animated reveal on answer
 *  - Domain badge per question (Resume Skills / JD Competencies / DBMS / OOP / …)
 *  - Live progress bar across all questions
 *  - Final results screen with score, correct/wrong breakdown, explanations
 *  - Saves aptitude results to context → localStorage → mockpro_session
 *  - "Proceed to Coding IDE" triggers setPhase(PHASES.CODING)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Brain, ArrowLeft, ArrowRight, Loader2, AlertCircle,
  CheckCircle2, XCircle, Clock, Trophy, BarChart3,
  RefreshCw, ChevronRight, BookOpen, Zap,
} from 'lucide-react';
import { useInterview, PHASES } from '../context/InterviewContext';
import { generateAptitudeQuiz } from '../services/groqService';

// ─── Constants ───────────────────────────────────────────────────────────────
const QUESTION_TIME_SECONDS = 20;
const TOTAL_QUESTIONS = 10;

// Domain badge styles
const DOMAIN_BADGE = {
  'Resume Skills':      'bg-brand-900/60 text-brand-300 border-brand-700/50',
  'JD Competencies':    'bg-accent-600/20 text-accent-300 border-accent-500/40',
  'DBMS':               'bg-sky-900/40 text-sky-300 border-sky-700/40',
  'OOP':                'bg-emerald-900/40 text-emerald-300 border-emerald-700/40',
  'Computer Networks':  'bg-orange-900/40 text-orange-300 border-orange-700/40',
  'Operating Systems':  'bg-yellow-900/40 text-yellow-300 border-yellow-700/40',
  'General':            'bg-gray-800/60 text-gray-400 border-gray-700/40',
};

function getDomainStyle(domain) {
  return DOMAIN_BADGE[domain] ?? DOMAIN_BADGE['General'];
}

// ─── Score colour helper ─────────────────────────────────────────────────────
function getScoreColor(pct) {
  if (pct >= 80) return 'text-emerald-400';
  if (pct >= 60) return 'text-yellow-400';
  if (pct >= 40) return 'text-orange-400';
  return 'text-red-400';
}
function getScoreLabel(pct) {
  if (pct >= 80) return { label: 'Excellent', emoji: '🏆' };
  if (pct >= 60) return { label: 'Good',      emoji: '👍' };
  if (pct >= 40) return { label: 'Average',   emoji: '📈' };
  return          { label: 'Needs Work',  emoji: '💪' };
}

// ─── Option Button ───────────────────────────────────────────────────────────
function OptionButton({ label, text, isSelected, isCorrect, isWrong, isRevealed, onClick, disabled }) {
  let classes = 'group flex items-start gap-3 w-full text-left px-4 py-3 rounded-xl border text-sm transition-all duration-200 ';

  if (isRevealed) {
    if (isCorrect)      classes += 'bg-emerald-900/30 border-emerald-500/60 text-emerald-200';
    else if (isWrong)   classes += 'bg-red-900/30 border-red-500/60 text-red-300';
    else                classes += 'bg-surface-800 border-white/8 text-gray-500';
  } else {
    if (isSelected)     classes += 'bg-brand-950/80 border-brand-500/60 text-brand-200 shadow-brand-sm';
    else                classes += 'bg-surface-800 border-white/8 text-gray-300 hover:border-brand-600/50 hover:bg-brand-950/30 hover:text-white cursor-pointer';
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={classes}
      id={`option-${label.toLowerCase()}`}
    >
      {/* Option label bubble */}
      <span className={`
        shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold border mt-0.5
        ${isRevealed && isCorrect ? 'bg-emerald-500 border-emerald-400 text-white'
          : isRevealed && isWrong ? 'bg-red-500 border-red-400 text-white'
          : isSelected             ? 'bg-brand-600 border-brand-500 text-white'
          : 'bg-surface-700 border-white/15 text-gray-500 group-hover:border-brand-600/50 group-hover:text-brand-300'}
      `}>
        {label}
      </span>
      <span className="leading-snug">{text}</span>
      {isRevealed && isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-400 ml-auto shrink-0 mt-0.5" />}
      {isRevealed && isWrong   && <XCircle      className="w-4 h-4 text-red-400 ml-auto shrink-0 mt-0.5" />}
    </button>
  );
}

// ─── Timer Ring ──────────────────────────────────────────────────────────────
function TimerRing({ secondsLeft, total }) {
  const pct = secondsLeft / total;
  const r = 18;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  const color = secondsLeft <= 5 ? '#f87171' : secondsLeft <= 10 ? '#fbbf24' : '#6371f1';

  return (
    <div className="relative w-14 h-14 flex items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" width="56" height="56" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3" />
        <circle
          cx="28" cy="28" r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
        />
      </svg>
      <span className={`text-sm font-bold font-mono ${secondsLeft <= 15 ? 'text-red-400' : 'text-gray-300'}`}>
        {secondsLeft}
      </span>
    </div>
  );
}

// ─── Loading Screen ──────────────────────────────────────────────────────────
function LoadingQuiz({ candidateData }) {
  const dots = [0, 1, 2];
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6 animate-fade-in">
      <div className="relative w-20 h-20">
        <div className="absolute inset-0 rounded-full bg-brand-gradient opacity-20 animate-ping" />
        <div className="relative w-20 h-20 rounded-full bg-brand-gradient flex items-center justify-center shadow-brand-lg">
          <Brain className="w-9 h-9 text-white" />
        </div>
      </div>

      <div className="text-center">
        <h3 className="text-xl font-bold text-white mb-2">Generating your quiz…</h3>
        <p className="text-gray-400 text-sm max-w-xs">
          AI is crafting questions tailored to your resume and the job description.
        </p>
      </div>

      {/* Animated progress steps */}
      <div className="w-full max-w-xs space-y-2">
        {['Analysing profile', 'Selecting domains', 'Writing questions'].map((step, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-surface-800 border border-white/5">
            <Loader2 className="w-4 h-4 text-brand-400 animate-spin shrink-0"
              style={{ animationDelay: `${i * 200}ms` }} />
            <span className="text-sm text-gray-400">{step}</span>
          </div>
        ))}
      </div>

      {candidateData?.parsedProfile?.roleTitle && (
        <p className="text-xs text-gray-600">
          Tailoring for: <span className="text-brand-400">{candidateData.parsedProfile.roleTitle}</span>
        </p>
      )}
    </div>
  );
}

// ─── Results Screen ──────────────────────────────────────────────────────────
function ResultsScreen({ questions, userAnswers, score, totalTime, onRetry, onProceed }) {
  const pct = Math.round((score / questions.length) * 100);
  const { label, emoji } = getScoreLabel(pct);
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="animate-slide-up space-y-6">

      {/* Score card */}
      <div className="relative overflow-hidden rounded-2xl bg-surface-800 border border-white/8 shadow-glass p-8 text-center">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-950/40 to-transparent pointer-events-none" />

        <div className="relative text-5xl mb-3">{emoji}</div>
        <h2 className="relative text-2xl font-black text-white mb-1">{label}!</h2>
        <p className="relative text-gray-400 text-sm mb-6">
          You answered <span className="text-white font-semibold">{score} of {questions.length}</span> questions correctly
        </p>

        {/* Score ring */}
        <div className="relative flex items-center justify-center mb-6">
          <svg width="140" height="140" viewBox="0 0 140 140" className="-rotate-90">
            <circle cx="70" cy="70" r="58" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
            <circle
              cx="70" cy="70" r="58"
              fill="none"
              stroke="url(#scoreGrad)"
              strokeWidth="10"
              strokeDasharray={2 * Math.PI * 58}
              strokeDashoffset={2 * Math.PI * 58 * (1 - pct / 100)}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 1.2s ease-out 0.3s' }}
            />
            <defs>
              <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#6371f1" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute flex flex-col items-center">
            <span className={`text-4xl font-black ${getScoreColor(pct)}`}>{pct}%</span>
            <span className="text-xs text-gray-500 mt-0.5">Score</span>
          </div>
        </div>

        {/* Stats row */}
        <div className="relative grid grid-cols-3 gap-3 mb-6">
          {[
            { icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />, label: 'Correct', value: score, color: 'text-emerald-400' },
            { icon: <XCircle     className="w-4 h-4 text-red-400" />,     label: 'Wrong',   value: questions.length - score, color: 'text-red-400' },
            { icon: <Clock       className="w-4 h-4 text-brand-400" />,   label: 'Avg time', value: `${Math.round(totalTime / questions.length)}s`, color: 'text-brand-300' },
          ].map(({ icon, label, value, color }) => (
            <div key={label} className="flex flex-col items-center gap-1 p-3 rounded-xl bg-surface-900/60 border border-white/5">
              {icon}
              <span className={`text-lg font-bold ${color}`}>{value}</span>
              <span className="text-[10px] text-gray-600">{label}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="relative flex gap-3">
          <button
            id="retry-quiz-btn"
            onClick={onRetry}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold
                       bg-surface-700 border border-white/10 text-gray-400
                       hover:text-white hover:border-white/20 transition-all duration-200"
          >
            <RefreshCw className="w-4 h-4" /> Retake Quiz
          </button>
          <button
            id="proceed-coding-btn"
            onClick={onProceed}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold
                       bg-brand-gradient text-white shadow-brand-sm hover:shadow-brand-md hover:scale-105 transition-all duration-200"
          >
            Coding IDE <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Detail toggle */}
      <button
        id="toggle-review-btn"
        onClick={() => setShowDetail(v => !v)}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 transition-colors mx-auto"
      >
        <BookOpen className="w-4 h-4" />
        {showDetail ? 'Hide' : 'Review'} all answers & explanations
        <ChevronRight className={`w-4 h-4 transition-transform ${showDetail ? 'rotate-90' : ''}`} />
      </button>

      {/* Per-question breakdown */}
      {showDetail && (
        <div className="space-y-3 animate-slide-up">
          {questions.map((q, qi) => {
            const chosen  = userAnswers[qi];
            const correct = q.answerIndex;
            const isRight = chosen === correct;
            const wasSkipped = chosen === null || chosen === undefined;

            return (
              <div
                key={q.id}
                className={`rounded-xl border p-4 ${
                  isRight ? 'bg-emerald-900/10 border-emerald-500/20'
                  : wasSkipped ? 'bg-surface-800 border-white/8'
                  : 'bg-red-900/10 border-red-500/20'
                }`}
              >
                <div className="flex items-start gap-3 mb-3">
                  <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${
                    isRight ? 'bg-emerald-500/20 text-emerald-400' : wasSkipped ? 'bg-gray-700 text-gray-500' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {qi + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${getDomainStyle(q.domain)}`}>
                        {q.domain}
                      </span>
                      {isRight ? (
                        <span className="text-xs text-emerald-400 font-semibold">✓ Correct</span>
                      ) : wasSkipped ? (
                        <span className="text-xs text-gray-500">— Timed out</span>
                      ) : (
                        <span className="text-xs text-red-400 font-semibold">✗ Incorrect</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-200 mb-2 leading-snug">{q.question}</p>

                    {/* Options mini-review */}
                    <div className="space-y-1">
                      {q.options.map((opt, oi) => {
                        const optLabel = String.fromCharCode(65 + oi);
                        const isAns    = oi === correct;
                        const isPicked = oi === chosen;
                        return (
                          <div
                            key={oi}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${
                              isAns   ? 'bg-emerald-900/30 text-emerald-300'
                              : isPicked && !isAns ? 'bg-red-900/30 text-red-300'
                              : 'text-gray-600'
                            }`}
                          >
                            <span className="font-bold w-4 shrink-0">{optLabel}.</span>
                            {opt.replace(/^[A-D]\.\s*/i, '')}
                            {isAns   && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 ml-auto shrink-0" />}
                            {isPicked && !isAns && <XCircle className="w-3.5 h-3.5 text-red-400 ml-auto shrink-0" />}
                          </div>
                        );
                      })}
                    </div>

                    {/* Explanation */}
                    {q.explanation && (
                      <div className="mt-2 p-2.5 rounded-lg bg-surface-900/60 border border-white/5">
                        <p className="text-xs text-gray-400 leading-relaxed">
                          <span className="text-brand-400 font-semibold">Explanation: </span>
                          {q.explanation}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main AptitudePhase Component ────────────────────────────────────────────
export default function AptitudePhase() {
  const {
    candidateData,
    aptitudeResults,
    aptitudeState,
    updateAptitudeState,
    setPhase,
    setAptitudeResults,
    appendTranscript,
  } = useInterview();

  // ── Quiz state machine ─────────────────────────────────────
  // 'idle' | 'loading' | 'quiz' | 'results' | 'error'
  const [quizState, setQuizState] = useState(() => {
    if (aptitudeResults) return 'results';
    if (aptitudeState?.questions?.length > 0) return 'quiz';
    return 'idle';
  });

  const [questions,    setQuestions]    = useState(aptitudeResults?.questions ?? aptitudeState?.questions ?? []);
  const [userAnswers,  setUserAnswers]  = useState(aptitudeResults?.userAnswers ?? aptitudeState?.userAnswers ?? []);
  const [currentIdx,   setCurrentIdx]  = useState(aptitudeState?.currentIdx ?? 0);
  const [selectedOpt,  setSelectedOpt] = useState(null);
  const [isRevealed,   setIsRevealed]  = useState(false);
  const [secondsLeft,  setSecondsLeft] = useState(QUESTION_TIME_SECONDS);
  const [totalTime,    setTotalTime]   = useState(aptitudeResults?.totalTime ?? 0);
  const [errorMsg,     setErrorMsg]    = useState('');

  // ── Sync in-progress quiz state across F5 page reload ──
  useEffect(() => {
    if (quizState === 'quiz' && questions.length > 0) {
      updateAptitudeState({ questions, userAnswers, currentIdx });
    }
  }, [quizState, questions, userAnswers, currentIdx, updateAptitudeState]);

  const timerRef   = useRef(null);
  const abortRef   = useRef(null);
  const timeUsed   = useRef(0); // seconds used for current question

  // Synchronized refs to prevent stale closure issues during interval/timeout transitions
  const selectedOptRef = useRef(selectedOpt);
  const currentIdxRef  = useRef(currentIdx);
  const questionsRef   = useRef(questions);
  const userAnswersRef = useRef(userAnswers);
  const totalTimeRef   = useRef(totalTime);

  useEffect(() => { selectedOptRef.current = selectedOpt; }, [selectedOpt]);
  useEffect(() => { currentIdxRef.current = currentIdx; }, [currentIdx]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);
  useEffect(() => { userAnswersRef.current = userAnswers; }, [userAnswers]);
  useEffect(() => { totalTimeRef.current = totalTime; }, [totalTime]);

  // ── Derived ────────────────────────────────────────────────
  const score = userAnswers.filter((ans, i) => ans === questions[i]?.answerIndex).length;
  const currentQ = questions[currentIdx];

  // ── Start timer (resets back to 20 seconds) ─────────────────
  const startTimer = useCallback(() => {
    setSecondsLeft(QUESTION_TIME_SECONDS);
    timeUsed.current = 0;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      timeUsed.current += 1;
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(timerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, []);

  // ── Core question advance & finish logic ───────────────────
  const advanceQuestion = useCallback((chosenOpt, timeSpentOnQ) => {
    clearInterval(timerRef.current);
    const newTotalTime = totalTimeRef.current + timeSpentOnQ;
    setTotalTime(newTotalTime);

    const idx = currentIdxRef.current;
    const qs = questionsRef.current;
    const newAnswers = [...userAnswersRef.current];
    newAnswers[idx] = chosenOpt;
    setUserAnswers(newAnswers);
    userAnswersRef.current = newAnswers;

    if (idx + 1 < qs.length) {
      setCurrentIdx(idx + 1);
      setSelectedOpt(null);
      setIsRevealed(false);
      // Reset timer back to 20 seconds when transitioning to a new question
      startTimer();
    } else {
      // Quiz complete — compute results
      const finalScore = newAnswers.filter((ans, i) => ans === qs[i]?.answerIndex).length;
      const results = {
        questions:   qs,
        userAnswers: newAnswers,
        score:       finalScore,
        total:       qs.length,
        percentage:  Math.round((finalScore / qs.length) * 100),
        totalTime:   newTotalTime,
        completedAt: Date.now(),
      };
      setAptitudeResults(results);
      updateAptitudeState(null);
      setQuizState('results');

      // Log to transcript
      appendTranscript({
        speaker: 'AI',
        text: `Aptitude quiz complete. Score: ${results.percentage}% (${finalScore}/${qs.length}). Proceeding to Coding IDE.`,
        phase: PHASES.APTITUDE,
      });
    }
  }, [setAptitudeResults, updateAptitudeState, appendTranscript, startTimer]);

  // ── Auto-advance/submit on timer expiry (reaches 0) ─────────
  useEffect(() => {
    if (quizState !== 'quiz') return;
    if (secondsLeft === 0 && !isRevealed) {
      const chosen = selectedOptRef.current ?? null;
      advanceQuestion(chosen, QUESTION_TIME_SECONDS);
    }
  }, [secondsLeft, quizState, isRevealed, advanceQuestion]);

  // ── Cleanup on unmount ─────────────────────────────────────
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  // ── Generate quiz ──────────────────────────────────────────
  const handleGenerateQuiz = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setQuizState('loading');
    setErrorMsg('');
    setQuestions([]);
    setUserAnswers([]);
    setCurrentIdx(0);
    setSelectedOpt(null);
    setIsRevealed(false);
    setTotalTime(0);

    const profile = candidateData?.parsedProfile ?? null;
    const skills  = candidateData?.parsedSkills  ?? [];

    const { data, error } = await generateAptitudeQuiz(profile, skills, controller.signal);

    if (error) {
      if (error !== 'Request aborted.') {
        setErrorMsg(error);
        setQuizState('error');
      }
      return;
    }

    setQuestions(data);
    questionsRef.current = data;
    const initialAnswers = new Array(data.length).fill(undefined);
    setUserAnswers(initialAnswers);
    userAnswersRef.current = initialAnswers;
    setQuizState('quiz');

    // Log to transcript
    appendTranscript({
      speaker: 'AI',
      text: `Aptitude quiz generated — ${data.length} questions across: ${[...new Set(data.map(q => q.domain))].join(', ')}.`,
      phase: PHASES.APTITUDE,
    });

    startTimer();
  }, [candidateData, appendTranscript, startTimer]);

  // ── Option select ──────────────────────────────────────────
  function handleSelectOption(idx) {
    if (isRevealed) return;
    setSelectedOpt(idx);
  }

  // ── Confirm answer / reveal explanation ─────────────────────
  function handleConfirmAnswer() {
    clearInterval(timerRef.current);
    const timeForQ = Math.max(1, QUESTION_TIME_SECONDS - secondsLeft);
    setTotalTime(t => t + timeForQ);
    setIsRevealed(true);
  }

  // ── Advance manually after reveal ──────────────────────────
  function handleNextQuestion() {
    advanceQuestion(selectedOptRef.current ?? null, 0);
  }

  // ── Retry quiz ─────────────────────────────────────────────
  function handleRetry() {
    setAptitudeResults(null);
    updateAptitudeState(null);
    handleGenerateQuiz();
  }

  // ── Proceed to Coding ──────────────────────────────────────
  function handleProceed() {
    setPhase(PHASES.CODING);
  }

  // ════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 animate-slide-up">
      <div className="rounded-2xl bg-surface-800 border border-white/8 shadow-glass overflow-hidden">

        {/* ── Phase Header ── */}
        <div className="px-6 py-5 border-b border-white/8 bg-gradient-to-r from-brand-950/60 to-surface-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-gradient flex items-center justify-center shadow-brand-sm">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Aptitude Round</h2>
                <p className="text-sm text-gray-400">
                  {quizState === 'quiz'
                    ? `Question ${currentIdx + 1} of ${questions.length}`
                    : quizState === 'results'
                    ? 'Quiz Complete'
                    : 'AI-generated MCQ quiz based on your profile'
                  }
                </p>
              </div>
            </div>

            {/* Progress pip row */}
            {quizState === 'quiz' && (
              <div className="hidden sm:flex items-center gap-1.5">
                {questions.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i < currentIdx
                        ? 'w-4 bg-brand-500'
                        : i === currentIdx
                        ? 'w-6 bg-brand-400'
                        : 'w-4 bg-surface-600'
                    }`}
                  />
                ))}
              </div>
            )}

            {/* Score badge on results */}
            {quizState === 'results' && aptitudeResults && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-brand-950/60 border border-brand-700/40">
                <Trophy className="w-4 h-4 text-yellow-400" />
                <span className={`text-sm font-bold ${getScoreColor(aptitudeResults.percentage)}`}>
                  {aptitudeResults.percentage}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-6 py-8">

          {/* IDLE STATE */}
          {quizState === 'idle' && (
            <div className="text-center py-8 animate-fade-in">
              <div className="text-6xl mb-5 animate-float">🧮</div>
              <h3 className="text-2xl font-bold text-white mb-3">Ready for your aptitude quiz?</h3>
              <p className="text-gray-400 text-sm max-w-sm mx-auto mb-2">
                10 questions crafted for your profile:
              </p>
              <div className="flex flex-wrap justify-center gap-2 mb-8">
                {[
                  { label: '60% Resume Skills', color: 'bg-brand-900/60 text-brand-300 border-brand-700/40' },
                  { label: '20% JD Competencies', color: 'bg-accent-600/20 text-accent-300 border-accent-500/30' },
                  { label: '20% CS Fundamentals', color: 'bg-sky-900/40 text-sky-300 border-sky-700/40' },
                ].map(({ label, color }) => (
                  <span key={label} className={`px-3 py-1 rounded-full text-xs font-semibold border ${color}`}>{label}</span>
                ))}
              </div>
              <div className="flex items-center justify-center gap-2 text-xs text-gray-600 mb-8">
                <Clock className="w-3.5 h-3.5" />
                <span>{QUESTION_TIME_SECONDS} seconds per question · auto-advances on timeout</span>
              </div>
              <button
                id="generate-quiz-btn"
                onClick={handleGenerateQuiz}
                className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-brand-gradient text-white
                           font-bold shadow-brand-md hover:shadow-brand-lg hover:scale-105 transition-all duration-200"
              >
                <Zap className="w-5 h-5" />
                Generate My Quiz
              </button>
            </div>
          )}

          {/* LOADING STATE */}
          {quizState === 'loading' && <LoadingQuiz candidateData={candidateData} />}

          {/* ERROR STATE */}
          {quizState === 'error' && (
            <div className="flex flex-col items-center gap-4 py-12 animate-fade-in">
              <div className="w-14 h-14 rounded-full bg-red-900/30 border border-red-500/30 flex items-center justify-center">
                <AlertCircle className="w-7 h-7 text-red-400" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-bold text-white mb-2">Quiz Generation Failed</h3>
                <p className="text-sm text-gray-400 max-w-xs">{errorMsg}</p>
              </div>
              <button
                id="retry-generate-btn"
                onClick={handleGenerateQuiz}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-gradient text-white text-sm font-semibold
                           shadow-brand-sm hover:shadow-brand-md hover:scale-105 transition-all duration-200"
              >
                <RefreshCw className="w-4 h-4" /> Try Again
              </button>
            </div>
          )}

          {/* QUIZ STATE */}
          {quizState === 'quiz' && currentQ && (
            <div className="animate-fade-in">

              {/* Progress bar */}
              <div className="h-1 bg-surface-700 rounded-full mb-6 overflow-hidden">
                <div
                  className="h-full bg-brand-gradient rounded-full transition-all duration-500"
                  style={{ width: `${((currentIdx) / questions.length) * 100}%` }}
                />
              </div>

              {/* Question card */}
              <div className="flex items-start gap-4 mb-6">
                <TimerRing secondsLeft={secondsLeft} total={QUESTION_TIME_SECONDS} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${getDomainStyle(currentQ.domain)}`}>
                      {currentQ.domain}
                    </span>
                    <span className="text-xs text-gray-600">Q{currentQ.id}</span>
                  </div>
                  <p className="text-base font-semibold text-white leading-snug">
                    {currentQ.question}
                  </p>
                </div>
              </div>

              {/* Options */}
              <div className="space-y-2.5 mb-6">
                {currentQ.options.map((opt, oi) => {
                  const label = String.fromCharCode(65 + oi);
                  const text  = opt.replace(/^[A-D]\.\s*/i, '');
                  return (
                    <OptionButton
                      key={oi}
                      label={label}
                      text={text}
                      isSelected={selectedOpt === oi}
                      isCorrect={isRevealed && oi === currentQ.answerIndex}
                      isWrong={isRevealed && selectedOpt === oi && oi !== currentQ.answerIndex}
                      isRevealed={isRevealed}
                      onClick={() => handleSelectOption(oi)}
                      disabled={isRevealed}
                    />
                  );
                })}
              </div>

              {/* Explanation (revealed) */}
              {isRevealed && currentQ.explanation && (
                <div className="mb-5 p-4 rounded-xl bg-surface-900/60 border border-brand-800/30 animate-fade-in">
                  <p className="text-xs text-gray-400 leading-relaxed">
                    <span className="text-brand-400 font-semibold">📖 Explanation: </span>
                    {currentQ.explanation}
                  </p>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3">
                {!isRevealed ? (
                  <button
                    id="confirm-answer-btn"
                    onClick={() => handleConfirmAnswer(false)}
                    disabled={selectedOpt === null}
                    className={`
                      flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm
                      transition-all duration-200
                      ${selectedOpt !== null
                        ? 'bg-brand-gradient text-white shadow-brand-sm hover:shadow-brand-md hover:scale-[1.02] active:scale-[0.98]'
                        : 'bg-surface-700 text-gray-600 border border-white/5 cursor-not-allowed'
                      }
                    `}
                  >
                    {selectedOpt !== null ? (
                      <><CheckCircle2 className="w-4 h-4" /> Confirm Answer</>
                    ) : (
                      <>Select an option above</>
                    )}
                  </button>
                ) : (
                  <button
                    id="next-question-btn"
                    onClick={handleNextQuestion}
                    className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm
                               bg-brand-gradient text-white shadow-brand-sm hover:shadow-brand-md hover:scale-[1.02] transition-all duration-200"
                  >
                    {currentIdx + 1 < questions.length ? (
                      <><ArrowRight className="w-4 h-4" /> Next Question</>
                    ) : (
                      <><BarChart3 className="w-4 h-4" /> View Results</>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* RESULTS STATE */}
          {quizState === 'results' && aptitudeResults && (
            <ResultsScreen
              questions={aptitudeResults.questions}
              userAnswers={aptitudeResults.userAnswers}
              score={aptitudeResults.score}
              totalTime={aptitudeResults.totalTime}
              onRetry={handleRetry}
              onProceed={handleProceed}
            />
          )}
        </div>

        {/* ── Footer Nav ── */}
        {(quizState === 'idle' || quizState === 'error') && (
          <div className="px-6 py-4 border-t border-white/8 flex justify-between">
            <button
              id="aptitude-back-btn"
              onClick={() => setPhase(PHASES.SETUP)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-gray-400
                         bg-surface-700 border border-white/10 hover:text-white hover:border-white/20 transition-all duration-200"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Setup
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
