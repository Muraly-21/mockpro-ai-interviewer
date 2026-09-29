/**
 * VoicePhase.jsx – Phase 3: Combined HR & Technical Interview Round
 *
 * Implements a company-standard 12-stage interview:
 *  - Stage 1: Mandatory Self-Introduction & Career Pitch
 *  - Stages 2–8: 7 Technical & Project Deep-Dives from Candidate's Resume
 *  - Stages 9–12: 4 Behavioral Questions (evaluated strictly with STAR method)
 *
 * Key Capabilities:
 *  - Auto Mic Activation: Automatically listens when the interviewer finishes speaking.
 *  - Live Subtitles: Displays real-time speech transcription so candidate knows they are heard.
 *  - Silence & Inactivity Alerting: Spoken verbal prompts at 15s and 30s if candidate pauses.
 *  - Pre-flight Gate: Hardware verification with frozen timer before round begins.
 *  - Instant Answer Submission: "Done Speaking / Submit Response" button.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Mic, MicOff, Volume2, VolumeX, ArrowRight, Loader2,
  Sparkles, Radio, MessageSquare, ChevronRight, Activity,
  Trophy, AlertTriangle, UserCheck, ShieldCheck, CheckCircle2, CornerDownLeft
} from 'lucide-react';
import { useInterview, PHASES } from '../context/InterviewContext';
import useVoiceInterviewer, { ENGINE, SPEAKING_STATE } from '../hooks/useVoiceInterviewer';
import { generateHRQuestions } from '../utils/hrQuestionGenerator';
import { generateSTARScorecard } from '../services/groqService';
import AudioHardwareCheckModal from '../components/AudioHardwareCheckModal';

// ─── Engine badge ─────────────────────────────────────────────────────────────
function EngineBadge({ engine, speakingState }) {
  const isCandidate = speakingState === SPEAKING_STATE.CANDIDATE_SPEAKING;
  const isAI = speakingState === SPEAKING_STATE.AI_SPEAKING;
  const isProc = speakingState === SPEAKING_STATE.PROCESSING;

  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2.5 w-2.5">
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
          isCandidate ? 'bg-emerald-400' : isAI ? 'bg-brand-400' : isProc ? 'bg-amber-400' : 'bg-gray-400'
        }`} />
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
          isCandidate ? 'bg-emerald-500' : isAI ? 'bg-brand-500' : isProc ? 'bg-amber-500' : 'bg-gray-500'
        }`} />
      </span>
      <span className="text-xs font-mono text-gray-400">
        {isCandidate ? 'Hearing You' : isAI ? 'Interviewer Speaking' : isProc ? 'Analyzing…' : 'Groq + Gemini Voice'}
      </span>
    </div>
  );
}

// ─── Audio visualizer bars ────────────────────────────────────────────────────
function AudioVisualiser({ level = 0, state = SPEAKING_STATE.IDLE }) {
  const count = 14;
  const bars = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const centerDist = Math.abs(i - count / 2) / (count / 2);
      const factor = 1 - centerDist * 0.5;
      const height = Math.max(10, Math.min(100, Math.round(level * factor * 100 * (1 + Math.random() * 0.4))));
      return height;
    });
  }, [level, count]);

  const barColor = state === SPEAKING_STATE.CANDIDATE_SPEAKING
    ? 'bg-emerald-400'
    : state === SPEAKING_STATE.AI_SPEAKING
      ? 'bg-brand-400'
      : 'bg-white/20';

  return (
    <div className="flex items-center gap-1 h-8 px-2">
      {bars.map((h, i) => (
        <div
          key={i}
          className={`w-1 rounded-full transition-all duration-75 ${barColor}`}
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

// ─── Animated mic ring ────────────────────────────────────────────────────────
function MicRing({ active }) {
  return (
    <div className="relative flex items-center justify-center w-20 h-20">
      {active && (
        <>
          <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" style={{ animationDuration: '2s' }} />
          <div className="absolute -inset-2 rounded-full border border-emerald-500/30 animate-spin" style={{ animationDuration: '6s' }} />
        </>
      )}
      <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg ${
        active
          ? 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/30 scale-105'
          : 'bg-surface-700 hover:bg-surface-600 text-gray-400 hover:text-white'
      }`}>
        {active ? <Mic className="w-7 h-7 text-white" /> : <MicOff className="w-7 h-7 text-gray-400" />}
      </div>
    </div>
  );
}

// ─── Transcript Bubble ────────────────────────────────────────────────────────
function TranscriptBubble({ entry }) {
  const isCandidate = entry.speaker === 'Candidate';
  const isSystem = entry.speaker === 'System';

  if (isSystem) {
    return (
      <div className="text-center text-xs text-gray-500 py-1 font-mono">
        {entry.text}
      </div>
    );
  }

  return (
    <div className={`flex gap-3 text-sm animate-fade-in ${isCandidate ? 'justify-end' : 'justify-start'}`}>
      {!isCandidate && (
        <div className="w-7 h-7 rounded-lg bg-brand-gradient flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5">
          AI
        </div>
      )}
      <div className={`max-w-[82%] px-4 py-2.5 rounded-2xl leading-relaxed text-sm ${
        isCandidate
          ? 'bg-brand-600/30 border border-brand-500/30 text-white rounded-tr-sm'
          : 'bg-surface-700/80 border border-white/8 text-gray-200 rounded-tl-sm'
      }`}>
        <p className="whitespace-pre-wrap">{entry.text}</p>
        <span className="text-[10px] text-gray-400 block text-right mt-1 font-mono">
          {new Date(entry.ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {isCandidate && (
        <div className="w-7 h-7 rounded-lg bg-emerald-600/40 border border-emerald-500/30 flex items-center justify-center text-xs font-bold text-emerald-300 shrink-0 mt-0.5">
          You
        </div>
      )}
    </div>
  );
}

// ─── Question Progress ────────────────────────────────────────────────────────
function QuestionProgress({ current, total, questions }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1 items-center">
        {Array.from({ length: total }, (_, i) => {
          const q = questions[i];
          const isComplete = i < current;
          const isCurrent = i === current;
          const isSTAR = q?.type === 'behavioral';
          const isIntro = q?.type === 'intro';

          return (
            <div
              key={i}
              title={`Question ${i + 1}: ${q?.category}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                isComplete
                  ? isSTAR ? 'bg-rose-500 w-4' : isIntro ? 'bg-indigo-500 w-4' : 'bg-brand-500 w-4'
                  : isCurrent
                    ? 'w-7 animate-pulse ' + (isSTAR ? 'bg-rose-400' : isIntro ? 'bg-indigo-400' : 'bg-brand-400')
                    : 'bg-white/10 w-3 sm:w-4'
              }`}
            />
          );
        })}
        <span className="text-xs text-gray-400 ml-1.5 font-mono">
          {Math.min(current + 1, total)}/{total}
        </span>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function VoicePhase() {
  const { transcriptHistory, setPhase, setScorecard, candidateData, appendTranscript } = useInterview();

  const [questionIdx, setQuestionIdx] = useState(0);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionDone, setSessionDone] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [liveLevel, setLiveLevel] = useState(0);
  const [showHardwareCheck, setShowHardwareCheck] = useState(false);

  // Inactivity & Silence prompt state
  const [silenceSeconds, setSilenceSeconds] = useState(0);
  const [silenceAlertBanner, setSilenceAlertBanner] = useState(null);
  const silencePromptCountRef = useRef(0);

  const transcriptRef = useRef(null);
  const levelTimerRef = useRef(null);

  // Generate 12 standard interview questions dynamically
  const questions = useMemo(() => generateHRQuestions(candidateData), [candidateData]);
  const currentQ = questions[questionIdx] || questions[0];

  const targetCompany = candidateData?.targetCompany || 'MAANG';

  const systemPrompt = `You are a Principal Technical & HR Interviewer at ${targetCompany} conducting the combined HR & Technical Round for a ${
    candidateData?.parsedProfile?.roleTitle ?? 'Software Engineer'
  } candidate.
Current Stage: ${currentQ.category} (Question ${questionIdx + 1} of ${questions.length})
Current Question: "${currentQ.question}"
Interview Guidelines:
1. Speak in clear, professional sentences without markdown, asterisks, or code blocks.
2. Keep responses concise (under 25 words).
3. If this is a behavioral question, assess for the STAR method (Situation, Task, Action, Result).
4. For technical questions, evaluate architectural clarity and trade-offs.`;

  const {
    engine, speakingState, isInitialising, isMicOn, isTTSOn,
    micLevel, transcript, interimText, submitCurrentSpeech,
    init, shutdown, startMic, stopMic, toggleMic, sendText, toggleTTS, greet, speak, askQuestion,
  } = useVoiceInterviewer({
    systemPrompt,
    onTranscript: () => {
      // Candidate spoke -> reset silence tracking
      setSilenceSeconds(0);
      setSilenceAlertBanner(null);
      silencePromptCountRef.current = 0;
    },
    onError: (msg) => console.warn('[HRPhase] Voice error:', msg),
  });

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  // Audio level animation
  useEffect(() => {
    if (sessionStarted && !sessionDone) {
      levelTimerRef.current = setInterval(() => {
        setLiveLevel(micLevel + Math.random() * 0.05);
      }, 80);
    }
    return () => clearInterval(levelTimerRef.current);
  }, [sessionStarted, sessionDone, micLevel]);

  // ── Inactivity / Silence Monitoring System ─────────────────────────────
  // If candidate is silent after question is asked:
  // 15 seconds: Audible verbal prompt from interviewer + visual banner
  // 30 seconds: Second audible nudge with option to skip
  useEffect(() => {
    if (!sessionStarted || sessionDone || speakingState !== SPEAKING_STATE.IDLE) {
      return;
    }

    const timer = setInterval(() => {
      setSilenceSeconds(s => s + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [sessionStarted, sessionDone, speakingState]);

  // Handle Inactivity Alerts
  useEffect(() => {
    if (speakingState === SPEAKING_STATE.CANDIDATE_SPEAKING || interimText) {
      return;
    }
    if (silenceSeconds === 25 && silencePromptCountRef.current === 0) {
      silencePromptCountRef.current = 1;
      const prompt = currentQ.inactivityPrompt || "Take your time. Feel free to explain your approach or walk me through your project whenever you're ready.";
      setSilenceAlertBanner(prompt);
      speak(prompt);
    } else if (silenceSeconds === 50 && silencePromptCountRef.current === 1) {
      silencePromptCountRef.current = 2;
      const prompt = "Are you still there? Please go ahead and share your response, or you can click Next Question to proceed.";
      setSilenceAlertBanner(prompt);
      speak(prompt);
    }
  }, [silenceSeconds, currentQ, speak, speakingState, interimText]);

  // ── Start session ───────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    setSessionStarted(true);
    setSilenceSeconds(0);
    setSilenceAlertBanner(null);
    silencePromptCountRef.current = 0;
    await init();
    await startMic();
    // Deliver the first interview question aloud via TTS, then automatically open mic
    setTimeout(async () => {
      await askQuestion(questions[0].question);
    }, 400);
  }, [init, startMic, askQuestion, questions]);

  // ── Advance question ────────────────────────────────────────────────────
  const nextQuestion = useCallback(async () => {
    setSilenceSeconds(0);
    setSilenceAlertBanner(null);
    silencePromptCountRef.current = 0;
    if (questionIdx < questions.length - 1) {
      const next = questionIdx + 1;
      setQuestionIdx(next);
      const nextQ = questions[next];
      // Actively speak the new question and arm the microphone on completion
      await askQuestion(nextQ.question);
    } else {
      setSessionDone(true);
    }
  }, [questionIdx, questions, askQuestion]);

  // ── Replay current question ─────────────────────────────────────────────
  const replayQuestion = useCallback(async () => {
    if (currentQ?.question) {
      setSilenceSeconds(0);
      setSilenceAlertBanner(null);
      await askQuestion(currentQ.question);
    }
  }, [currentQ, askQuestion]);

  // ── Generate final scorecard ────────────────────────────────────────────
  const generateScorecard = useCallback(async () => {
    setIsGenerating(true);
    const allTranscripts = [
      ...transcriptHistory,
      ...transcript.map(t => ({ ...t, phase: PHASES.HR })),
    ];
    const { data, error } = await generateSTARScorecard(
      allTranscripts,
      candidateData?.targetJD ?? `${targetCompany} Senior Software Engineer Requirements`,
    );
    setIsGenerating(false);
    if (!error && data) {
      setScorecard(data);
    }
    setPhase(PHASES.SCORECARD);
  }, [transcriptHistory, transcript, candidateData, targetCompany, setScorecard, setPhase]);

  // ── Text send ───────────────────────────────────────────────────────────
  const handleSendText = useCallback(() => {
    if (!textInput.trim()) return;
    setSilenceSeconds(0);
    setSilenceAlertBanner(null);
    silencePromptCountRef.current = 0;
    sendText(textInput);
    setTextInput('');
  }, [textInput, sendText]);

  // ── Pre-start Screen ────────────────────────────────────────────────────
  if (!sessionStarted) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        {/* Hardware Check Modal */}
        <AudioHardwareCheckModal
          isOpen={showHardwareCheck}
          onComplete={() => {
            setShowHardwareCheck(false);
            startSession();
          }}
          roundName="HR & Technical Fit Round"
        />

        <div className="max-w-xl w-full text-center space-y-6 animate-slide-up">

          {/* Icon Badge */}
          <div className="relative mx-auto w-24 h-24">
            <div className="absolute inset-0 rounded-full bg-brand-500/20 animate-ping" style={{ animationDuration: '2.5s' }} />
            <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-brand-600 via-purple-600 to-indigo-700
                            flex items-center justify-center shadow-brand-md">
              <UserCheck className="w-10 h-10 text-white" />
            </div>
          </div>

          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-brand-500/10 border border-brand-500/20 text-brand-300 mb-3">
              <Sparkles className="w-3.5 h-3.5" /> Company Standard Interview Bar: {targetCompany}
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-white mb-2">
              HR &amp; Technical Fit Round
            </h1>
            <p className="text-gray-400 text-sm max-w-md mx-auto">
              A conversational interview evaluating your real-world engineering depth, system architecture decisions, and behavioral leadership.
            </p>
          </div>

          {/* Guidelines & Key Focus Areas */}
          <div className="text-left bg-surface-800 rounded-2xl border border-white/8 p-5 space-y-3">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Key Focus Areas &amp; Guidelines:</p>
            {[
              ['🎯', 'Technical Architecture & Projects', 'Walk through your real-world systems, technology choices, trade-offs, and production engineering.'],
              ['⭐', 'Behavioral Leadership (STAR Approach)', 'Highlight situation context, key tasks, direct actions, and measurable business outcomes.'],
              ['🎙️', 'Voice-First Conversational Experience', 'Speak naturally at your normal conversational pace. Real-time subtitles and audio assistance are active.'],
              ['⚡', 'Tips for High Performance', 'Structure answers with clarity, quantify your impact where possible, and emphasize personal ownership.'],
            ].map(([icon, title, desc]) => (
              <div key={title} className="flex items-start gap-3 text-sm">
                <span className="text-lg shrink-0 mt-0.5">{icon}</span>
                <div>
                  <p className="text-gray-200 font-semibold text-xs sm:text-sm">{title}</p>
                  <p className="text-gray-500 text-xs">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Hardware testing CTA */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              id="hr-audio-check-btn"
              onClick={() => setShowHardwareCheck(true)}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-2xl
                         text-sm font-semibold bg-surface-700 hover:bg-surface-600 text-gray-200
                         border border-white/10 transition-all duration-200 cursor-pointer"
            >
              <Mic className="w-4 h-4 text-brand-400" /> Verify Mic &amp; Audio
            </button>

            <button
              type="button"
              id="hr-start-session-btn"
              onClick={() => setShowHardwareCheck(true)}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-2xl
                         text-sm font-bold text-white bg-brand-gradient
                         shadow-brand-md hover:shadow-brand-lg hover:scale-105 active:scale-95
                         transition-all duration-200 cursor-pointer"
            >
              Start HR Round <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Session Finished Screen ─────────────────────────────────────────────
  if (sessionDone) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-surface-900 border border-white/10 rounded-2xl p-6 sm:p-8 text-center space-y-6 shadow-2xl animate-scale-in">
          <div className="w-16 h-16 rounded-2xl bg-brand-gradient flex items-center justify-center mx-auto shadow-brand-md">
            <Trophy className="w-8 h-8 text-white" />
          </div>

          <div>
            <h2 className="text-2xl font-black text-white">HR &amp; Technical Round Completed!</h2>
            <p className="text-sm text-gray-400 mt-2">
              All interview responses have been recorded. You can now generate your full 360° MAANG Evaluation Scorecard.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              ['Introduction', '✓', 'text-indigo-400'],
              ['Technical Depth', 'Evaluated', 'text-brand-400'],
              ['STAR Behavioral', 'Evaluated', 'text-rose-400'],
            ].map(([label, icon, color]) => (
              <div key={label} className="bg-surface-800 rounded-xl border border-white/8 p-3 text-center">
                <div className={`text-lg font-bold ${color}`}>{icon}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          <button
            id="hr-complete-scorecard-btn"
            onClick={generateScorecard}
            disabled={isGenerating}
            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl
                       text-base font-bold text-white bg-brand-gradient
                       shadow-brand-md hover:shadow-brand-lg hover:scale-105 active:scale-95
                       disabled:opacity-70 disabled:cursor-default transition-all duration-200"
          >
            {isGenerating ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Generating 360° Scorecard…</>
            ) : (
              <><Trophy className="w-5 h-5" /> View Detailed 360° Scorecard</>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Active Session Layout ───────────────────────────────────────────────
  const isBehavioral = currentQ.type === 'behavioral';
  const isIntro = currentQ.type === 'intro';

  return (
    <div className="flex-1 flex flex-col min-h-0 max-w-5xl mx-auto w-full px-4 py-4 gap-4">

      {/* ── Session Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${
            isBehavioral
              ? 'bg-rose-950/40 border-rose-500/30 text-rose-300'
              : isIntro
                ? 'bg-indigo-950/40 border-indigo-500/30 text-indigo-300'
                : 'bg-brand-950/40 border-brand-500/30 text-brand-300'
          }`}>
            <Radio className="w-3.5 h-3.5" />
            Phase 3 · HR &amp; Technical Fit
          </div>
          <QuestionProgress current={questionIdx} total={questions.length} questions={questions} />
        </div>
        {sessionStarted && (
          <EngineBadge engine={engine} speakingState={speakingState} />
        )}
      </div>

      {/* ── Main Split ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Left: Voice Control Hub + Active Question ───────────────────── */}
        <div className="lg:col-span-2 flex flex-col gap-4">

          {/* Voice Control Hub */}
          <div className="bg-surface-800 rounded-2xl border border-white/8 shadow-glass p-5 flex flex-col items-center gap-4">

            {/* Waveform visualizer */}
            <div className="w-full bg-surface-900 rounded-xl border border-white/6 p-3">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                <span>AI Interviewer</span>
                <span>Your Mic</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <AudioVisualiser level={liveLevel} state={speakingState === SPEAKING_STATE.AI_SPEAKING ? speakingState : SPEAKING_STATE.IDLE} />
                </div>
                <div className="w-px h-7 bg-white/10" />
                <div className="flex-1">
                  <AudioVisualiser level={micLevel} state={isMicOn ? SPEAKING_STATE.CANDIDATE_SPEAKING : SPEAKING_STATE.IDLE} />
                </div>
              </div>
            </div>

            {/* Status label */}
            <div className="text-xs sm:text-sm font-semibold text-center min-h-[24px]">
              {isInitialising ? (
                <span className="flex items-center gap-2 text-brand-400">
                  <Loader2 className="w-4 h-4 animate-spin" /> Connecting to interviewer voice…
                </span>
              ) : speakingState === SPEAKING_STATE.AI_SPEAKING ? (
                <span className="text-brand-400 animate-pulse">🎙 Interviewer Speaking…</span>
              ) : speakingState === SPEAKING_STATE.CANDIDATE_SPEAKING || isMicOn ? (
                <span className="text-emerald-400 flex items-center gap-2 justify-center">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                  Listening — Speak naturally…
                </span>
              ) : speakingState === SPEAKING_STATE.PROCESSING ? (
                <span className="text-amber-400 flex items-center gap-2 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> Evaluating response…
                </span>
              ) : (
                <span className="text-gray-400">Tap mic to speak (or type below)</span>
              )}
            </div>

            {/* Mic button & Quick submit */}
            <div className="flex flex-col items-center gap-2">
              <button
                id="hr-mic-toggle"
                type="button"
                onClick={toggleMic}
                disabled={isInitialising}
                className="disabled:opacity-50 disabled:cursor-default transition-transform hover:scale-105 active:scale-95"
                aria-label={isMicOn ? 'Stop recording' : 'Start recording'}
              >
                <MicRing active={isMicOn} />
              </button>

              {/* Submit Spoken Response Button */}
              {isMicOn && (
                <button
                  type="button"
                  id="hr-submit-speech-btn"
                  onClick={submitCurrentSpeech}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 transition-all duration-200 mt-1"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Done Speaking (Submit Answer)
                </button>
              )}
            </div>

            {/* Controls row */}
            <div className="flex items-center gap-2 w-full">
              <button
                id="hr-tts-toggle"
                type="button"
                onClick={toggleTTS}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                            border transition-all duration-200 ${
                  isTTSOn
                    ? 'bg-brand-950/30 border-brand-500/30 text-brand-300'
                    : 'bg-surface-700 border-white/10 text-gray-500'
                }`}
              >
                {isTTSOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                {isTTSOn ? 'Audio On' : 'Muted'}
              </button>

              <button
                id="hr-next-question"
                type="button"
                onClick={nextQuestion}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                           bg-surface-700 border border-white/10 text-gray-300 hover:text-white hover:border-white/20
                           transition-all duration-200"
              >
                Next Q <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Current Question Card */}
          <div className={`bg-surface-800 rounded-2xl border shadow-glass p-5 space-y-3 transition-colors ${
            isBehavioral
              ? 'border-rose-500/30'
              : isIntro
                ? 'border-indigo-500/30'
                : 'border-brand-500/30'
          }`}>
            <div className="flex items-center justify-between">
              <span className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                isBehavioral
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : isIntro
                    ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
                    : 'bg-brand-500/10 border-brand-500/30 text-brand-300'
              }`}>
                {isBehavioral ? '⭐ Behavioral (STAR)' : isIntro ? '👋 Self Introduction' : '💻 Technical & Project'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="hr-read-aloud-btn"
                  onClick={replayQuestion}
                  className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-500/15 border border-brand-500/30 text-brand-300 hover:bg-brand-500/25 transition-all"
                  title="Speak this question aloud"
                >
                  <Volume2 className="w-3 h-3" /> Read Aloud
                </button>
                <span className="text-xs text-gray-500 font-mono">Q{questionIdx + 1} of {questions.length}</span>
              </div>
            </div>

            <h3 className="text-xs font-semibold text-gray-400">{currentQ.title}</h3>

            <p className="text-sm text-gray-100 leading-relaxed font-medium">
              {currentQ.question}
            </p>

            <div className="pt-2 border-t border-white/5 flex items-start gap-2 text-xs text-gray-400">
              <Activity className="w-3.5 h-3.5 shrink-0 text-brand-400 mt-0.5" />
              <span>{currentQ.evaluationGuide}</span>
            </div>

            {/* Inactivity banner alert */}
            {silenceAlertBanner && (
              <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs space-y-1 animate-pulse">
                <div className="flex items-center gap-2 font-bold text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Interviewer is listening:</span>
                </div>
                <p className="pl-6 text-[11px] leading-relaxed">{silenceAlertBanner}</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Transcript Panel ───────────────────────────────────────── */}
        <div className="lg:col-span-3 flex flex-col bg-surface-800 rounded-2xl border border-white/8 shadow-glass overflow-hidden">

          {/* Header */}
          <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <MessageSquare className="w-4 h-4 text-brand-400" />
              Live Interview Conversation
            </div>
            <span className="text-xs text-gray-500">{transcript.length} turns</span>
          </div>

          {/* Body */}
          <div
            ref={transcriptRef}
            className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0"
          >
            {transcript.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-12">
                <div className="w-12 h-12 rounded-full bg-brand-950/50 border border-brand-500/20 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-brand-400" />
                </div>
                <p className="text-gray-400 text-sm font-medium">Interviewer dialogue will appear here…</p>
                <p className="text-gray-600 text-xs">Speak into your microphone or type below</p>
              </div>
            ) : (
              transcript.map((entry, i) => <TranscriptBubble key={i} entry={entry} />)
            )}
          </div>

          {/* Live Speech Recognition Pill (Candidate Feedback) */}
          {interimText && (
            <div className="px-4 py-2 bg-surface-900 border-t border-brand-500/30 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 truncate">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                <span className="text-gray-400 font-medium shrink-0">Hearing:</span>
                <span className="text-emerald-300 italic truncate">&ldquo;{interimText}&rdquo;</span>
              </div>
              <button
                type="button"
                onClick={submitCurrentSpeech}
                className="shrink-0 px-2.5 py-1 rounded bg-brand-500/20 hover:bg-brand-500/30 text-brand-300 font-semibold text-[11px] border border-brand-500/30"
              >
                Submit Now
              </button>
            </div>
          )}

          {/* Typing fallback */}
          <div className="px-4 py-3 border-t border-white/8">
            <div className="flex gap-2">
              <input
                type="text"
                id="hr-text-input"
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendText()}
                placeholder="Type your response (or speak via microphone)…"
                className="flex-1 bg-surface-900 border border-white/8 rounded-xl px-4 py-2.5 text-sm
                           text-gray-200 placeholder-gray-600 focus:outline-none
                           focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20 transition-all"
              />
              <button
                id="hr-text-send"
                type="button"
                onClick={handleSendText}
                disabled={!textInput.trim()}
                className="px-4 py-2.5 rounded-xl bg-brand-gradient text-white text-sm font-semibold
                           shadow-brand-sm hover:shadow-brand-md hover:scale-105 active:scale-95
                           disabled:opacity-40 disabled:cursor-default transition-all duration-200"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer Navigation ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button
          id="hr-back-btn"
          type="button"
          onClick={() => { shutdown(); setPhase(PHASES.CODING); }}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          ← Back to Coding IDE
        </button>

        <button
          id="hr-finish-btn"
          type="button"
          onClick={() => setSessionDone(true)}
          className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white
                     bg-brand-gradient shadow-brand-sm hover:shadow-brand-md hover:scale-105
                     active:scale-95 transition-all duration-200"
        >
          Finish HR Round <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
