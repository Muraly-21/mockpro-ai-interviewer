/**
 * Header.jsx – MOCK PRO global top navigation.
 *
 * Features:
 *  - Dark glassmorphism navbar with brand logo + icon
 *  - Phase progress tracker (5 steps with active/complete states)
 *  - "Reset Interview" button with confirmation
 *  - Ctrl+Shift+D badge indicator when devtools hotkey fires
 */

import { useState, useEffect } from 'react';
import { Brain, RotateCcw, ChevronRight, Zap, Key } from 'lucide-react';
import { useInterview } from '../context/InterviewContext';
import { PHASE_LABELS } from '../context/InterviewContext';
import BYOKModal from './BYOKModal';
import { cancel as ttsCancel } from '../services/ttsService';

const PHASE_ICONS = ['⚙️', '🧮', '💻', '🎙️', '🏆'];

import { getApiKeyStatus } from '../services/apiKeys';

export default function Header() {
  const { currentPhase, setPhase, resetInterview } = useInterview();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [devSeedFlash, setDevSeedFlash]         = useState(false);
  const [showBYOK,    setShowBYOK]              = useState(false);
  const [keyStatus,   setKeyStatus]             = useState(() => getApiKeyStatus());

  useEffect(() => {
    const onKeyChange = () => setKeyStatus(getApiKeyStatus());
    window.addEventListener('mockpro_keys_changed', onKeyChange);
    return () => window.removeEventListener('mockpro_keys_changed', onKeyChange);
  }, []);

  // Listen for Ctrl+Shift+D to flash dev indicator
  useEffect(() => {
    function onHotkey(e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        setDevSeedFlash(true);
        setTimeout(() => setDevSeedFlash(false), 2000);
      }
    }
    window.addEventListener('keydown', onHotkey);
    return () => window.removeEventListener('keydown', onHotkey);
  }, []);

  function handleReset() {
    if (!showResetConfirm) {
      setShowResetConfirm(true);
      // Auto-cancel confirm after 3s
      setTimeout(() => setShowResetConfirm(false), 3000);
      return;
    }
    ttsCancel();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch {}
    }
    resetInterview();
    setShowResetConfirm(false);
  }

  return (
    <header
      id="mockpro-header"
      className="sticky top-0 z-50 w-full border-b border-white/5 bg-surface-900/80 backdrop-blur-md shadow-glass"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">

          {/* ── Logo ── */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="relative w-9 h-9 rounded-xl bg-brand-gradient flex items-center justify-center shadow-brand-sm animate-pulse-glow">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-white font-black text-lg tracking-tight">
                MOCK<span className="text-brand-400"> PRO</span>
              </span>
              <span className="text-[10px] text-gray-500 font-medium tracking-widest uppercase">
                Interview Simulator
              </span>
            </div>
          </div>

          {/* ── Phase Progress Tracker ── */}
          <nav
            id="phase-progress-tracker"
            aria-label="Interview phases"
            className="hidden md:flex items-center gap-1 flex-1 justify-center"
          >
            {PHASE_LABELS.map((label, idx) => {
              const isComplete = idx < currentPhase;
              const isActive   = idx === currentPhase;
              const isFuture   = idx > currentPhase;

              return (
                <div key={idx} className="flex items-center">
                  {/* Step pill */}
                  <div
                    id={`phase-step-${idx}`}
                    onClick={() => {
                      if (isComplete) setPhase(idx);
                    }}
                    className={`
                      flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold
                      transition-all duration-300
                      ${isActive
                        ? 'bg-brand-gradient text-white shadow-brand-sm scale-105'
                        : isComplete
                        ? 'bg-brand-900/50 text-brand-300 border border-brand-700/50 cursor-pointer hover:bg-brand-800/60'
                        : 'text-gray-600 hover:text-gray-500'
                      }
                    `}
                    title={isComplete ? `Review ${label}` : label}
                  >
                    <span className="text-[11px]">{PHASE_ICONS[idx]}</span>
                    <span className="hidden lg:inline">{label}</span>
                    {isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse" />
                    )}
                    {isComplete && (
                      <span className="text-[10px] text-brand-400">✓</span>
                    )}
                  </div>

                  {/* Chevron separator */}
                  {idx < PHASE_LABELS.length - 1 && (
                    <ChevronRight
                      className={`w-3 h-3 mx-0.5 transition-colors duration-300 ${
                        isComplete ? 'text-brand-600' : 'text-gray-700'
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </nav>

          {/* ── Right Controls ── */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Dev seed flash badge */}
            {devSeedFlash && (
              <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent-600/20 border border-accent-500/30 text-accent-400 text-xs font-mono animate-fade-in">
                <Zap className="w-3 h-3" />
                Mock data loaded
              </span>
            )}

            {/* BYOK API Key button */}
            <button
              id="byok-settings-btn"
              onClick={() => setShowBYOK(true)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold
                         border transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500/50
                         ${keyStatus.hasGemini || keyStatus.hasGroq
                           ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 hover:border-emerald-500/60 hover:text-white'
                           : 'bg-surface-700 border-white/10 text-gray-400 hover:text-white hover:border-white/20'}`}
              title="Configure API Keys (BYOK)"
            >
              <Key className="w-3.5 h-3.5" />
              <span className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${keyStatus.hasGemini && keyStatus.hasGroq ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                <span className="hidden sm:inline">
                  {keyStatus.hasGemini && keyStatus.hasGroq ? 'AI Connected' : 'API Keys'}
                </span>
              </span>
            </button>

            {/* Reset button */}
            <button
              id="reset-interview-btn"
              onClick={handleReset}
              className={`
                flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold
                border transition-all duration-200
                focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-surface-900
                ${showResetConfirm
                  ? 'bg-red-500/20 border-red-500/50 text-red-300 focus:ring-red-500/50 hover:bg-red-500/30 animate-pulse'
                  : 'bg-surface-700 border-white/10 text-gray-400 hover:text-white hover:border-white/20 focus:ring-brand-500/50'
                }
              `}
              title="Reset Interview (clears all data)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {showResetConfirm ? 'Confirm Reset?' : 'Reset Interview'}
            </button>
          </div>

          {/* BYOK Modal */}
          <BYOKModal isOpen={showBYOK} onClose={() => setShowBYOK(false)} />

        </div>

        {/* ── Mobile Phase Tracker ── */}
        <div className="md:hidden flex items-center gap-2 pb-3 overflow-x-auto scrollbar-hide">
          {PHASE_LABELS.map((label, idx) => {
            const isActive = idx === currentPhase;
            const isComplete = idx < currentPhase;
            return (
              <div
                key={idx}
                id={`phase-mobile-${idx}`}
                onClick={() => {
                  if (isComplete) setPhase(idx);
                }}
                className={`
                  flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap shrink-0
                  transition-all duration-200
                  ${isActive
                    ? 'bg-brand-gradient text-white'
                    : isComplete
                    ? 'bg-brand-900/40 text-brand-400 cursor-pointer hover:bg-brand-800/60'
                    : 'text-gray-700'
                  }
                `}
              >
                <span>{PHASE_ICONS[idx]}</span>
                <span>{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </header>
  );
}
