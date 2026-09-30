/**
 * BYOKModal.jsx – Bring Your Own Key Modal & Audio Diagnostics.
 *
 * Priority order:
 *  1. localStorage  (mockpro_api_keys → geminiApiKey / groqApiKey)
 *  2. import.meta.env (VITE_GEMINI_API_KEY / VITE_GROQ_API_KEY)
 *  3. Bundled production fallback keys ($0/mo serverless out-of-the-box)
 *
 * Keys are saved to localStorage under `mockpro_api_keys`.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Key, X, Eye, EyeOff, CheckCircle2,
  ExternalLink, Save, Trash2,
  Volume2, Loader2, Sparkles, Zap, Lock, Infinity,
  AlertCircle, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  resolveGeminiKey,
  resolveGroqKey,
  saveApiKeys,
  clearApiKeys,
  getApiKeyStatus,
  DEFAULT_GEMINI_KEY,
  DEFAULT_GROQ_KEY,
} from '../services/apiKeys';
import { speak as ttsspeak } from '../services/ttsService';

const LS_KEY = 'mockpro_api_keys';

export function useBYOK() {
  const [showModal, setShowModal] = useState(false);
  const geminiKey = resolveGeminiKey();
  const groqKey   = resolveGroqKey();
  const hasKeys   = !!(geminiKey || groqKey);
  return { showModal, setShowModal, hasKeys, geminiKey, groqKey };
}

// ─── InputRow sub-component ─────────────────────────────────────────────────

function InputRow({ id, label, link, value, onChange, show, onToggle, statusLabel, placeholder, hasValue }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          {label}
          {hasValue && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-950/50 border border-emerald-500/25 px-2 py-0.5 rounded-full">
              <CheckCircle2 className="w-3 h-3" /> Connected
            </span>
          )}
        </label>
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors"
        >
          Get key <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {statusLabel && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-500/20 text-xs text-emerald-300">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
          {statusLabel}
        </div>
      )}

      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-surface-900 border border-white/10 rounded-xl px-4 py-3 pr-12
                     text-sm text-gray-200 placeholder-gray-600
                     focus:outline-none focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20
                     transition-all duration-200 font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? 'Hide key' : 'Show key'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors p-1"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

// ─── Key Plan Comparison sub-component ───────────────────────────────────────

function KeyPlanBanner({ isCustomGemini, isCustomGroq }) {
  const isFullyCustom = isCustomGemini && isCustomGroq;
  const isPartialCustom = isCustomGemini || isCustomGroq;

  return (
    <div className="rounded-xl overflow-hidden border border-white/8">
      {/* Header row */}
      <div className="grid grid-cols-2 text-center text-[10px] font-bold uppercase tracking-widest">
        <div className={`px-3 py-2 flex items-center justify-center gap-1.5 ${
          !isFullyCustom ? 'bg-amber-950/60 text-amber-300 border-b border-r border-amber-600/30' : 'bg-surface-900/80 text-gray-600 border-b border-r border-white/5'
        }`}>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          Shared Key (Current)
        </div>
        <div className={`px-3 py-2 flex items-center justify-center gap-1.5 ${
          isFullyCustom ? 'bg-emerald-950/60 text-emerald-300 border-b border-emerald-600/30' : 'bg-surface-900/80 text-gray-500 border-b border-white/5'
        }`}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          Your Own Key
        </div>
      </div>
      {/* Feature rows */}
      {[
        ['Shared rate limits', 'Dedicated rate limits'],
        ['May hit quotas during peak hours', 'Always available — your quota only'],
        ['No setup needed', 'Free tier: 1 500 req/day (Gemini)'],
        ['Limited concurrent sessions', 'Unlimited personal sessions'],
        ['Data via shared key', 'Full privacy — key never leaves browser'],
      ].map(([shared, own], i) => (
        <div key={i} className="grid grid-cols-2 text-[11px]">
          <div className="px-3 py-2 flex items-start gap-1.5 border-r border-white/5 text-amber-200/70">
            <span className="text-amber-500/70 mt-0.5 shrink-0">·</span>{shared}
          </div>
          <div className="px-3 py-2 flex items-start gap-1.5 text-emerald-200/80">
            <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />{own}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function BYOKModal({ isOpen, onClose }) {
  const [geminiKey,  setGeminiKey]  = useState('');
  const [groqKey,    setGroqKey]    = useState('');
  const [showGemini, setShowGemini] = useState(false);
  const [showGroq,   setShowGroq]   = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const panelRef = useRef(null);

  // Load existing keys whenever modal opens
  useEffect(() => {
    if (!isOpen) return;
    setSaved(false);
    try {
      const stored = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
      setGeminiKey(stored.geminiApiKey ?? '');
      setGroqKey(stored.groqApiKey ?? '');
    } catch {
      setGeminiKey('');
      setGroqKey('');
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Trap focus on open
  useEffect(() => {
    if (isOpen && panelRef.current) panelRef.current.focus();
  }, [isOpen]);

  const handleSave = useCallback(() => {
    saveApiKeys({
      geminiApiKey: geminiKey.trim(),
      groqApiKey:   groqKey.trim(),
    });
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose?.(); }, 1000);
  }, [geminiKey, groqKey, onClose]);

  const handleClear = useCallback(() => {
    clearApiKeys();
    setGeminiKey('');
    setGroqKey('');
  }, []);

  const handleTestVoice = useCallback(async () => {
    setTestingVoice(true);
    try {
      await ttsspeak('MockPro AI Voice and API connection verified. You are ready for the interview.', {
        onEnd: () => setTestingVoice(false),
      });
    } catch {
      setTestingVoice(false);
    }
  }, []);

  if (!isOpen) return null;

  const status = getApiKeyStatus();
  // Detect if currently using shared (bundled) keys vs custom user keys
  const usingSharedGemini = status.hasGemini && !status.isCustomGemini;
  const usingSharedGroq   = status.hasGroq   && !status.isCustomGroq;
  const usingAnyShared    = usingSharedGemini || usingSharedGroq;
  const usingBothCustom   = status.isCustomGemini && status.isCustomGroq;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] overflow-y-auto p-4 sm:p-6 flex min-h-full items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="byok-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md -z-10"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg my-auto flex flex-col rounded-2xl border border-white/10
                   bg-surface-800 outline-none overflow-hidden
                   shadow-[0_25px_80px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.04)]"
        style={{ maxHeight: 'min(92vh, 780px)' }}
      >
        {/* ── Header ── */}
        <div className="px-6 py-4 border-b border-white/8 bg-gradient-to-r from-brand-950/40 to-transparent shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-brand-gradient flex items-center justify-center shadow-brand-sm shrink-0">
                <Key className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 id="byok-modal-title" className="text-base font-bold text-white leading-tight">
                  API Key Configuration
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Stored securely in your browser &mdash; never sent to any server
                </p>
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500
                           hover:text-white hover:bg-white/8 transition-all duration-150 ml-3 shrink-0"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 scrollbar-hide">

          {/* ── BYOK Awareness Banner ── */}
          {usingAnyShared && !usingBothCustom && (
            <div
              id="byok-awareness-banner"
              className="rounded-xl border border-amber-500/40 bg-amber-950/30 overflow-hidden"
            >
              {/* Banner header */}
              <div className="flex items-start gap-3 px-4 pt-4 pb-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0 mt-0.5">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-amber-200 leading-tight">You're using a shared API key</p>
                  <p className="text-xs text-amber-300/80 mt-0.5 leading-relaxed">
                    MockPro works out-of-the-box with a bundled key — but shared keys have rate limits.
                    <strong className="text-amber-200"> Add your own free key for an uninterrupted experience.</strong>
                  </p>
                </div>
              </div>

              {/* Benefit pills */}
              <div className="px-4 pb-3 flex flex-wrap gap-2">
                {[
                  { icon: Infinity, label: 'No rate limits', color: 'text-emerald-300 bg-emerald-950/50 border-emerald-600/30' },
                  { icon: Zap,      label: 'Fastest responses', color: 'text-brand-300 bg-brand-950/50 border-brand-600/30' },
                  { icon: Lock,     label: 'Full privacy', color: 'text-sky-300 bg-sky-950/50 border-sky-600/30' },
                ].map(({ icon: Icon, label, color }) => (
                  <span key={label} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${color}`}>
                    <Icon className="w-3 h-3" />{label}
                  </span>
                ))}
              </div>

              {/* Steps */}
              <div className="border-t border-amber-600/20 px-4 py-3 bg-amber-950/20">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500/70 mb-2">Get your free key in 60 seconds</p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px] text-amber-200/80">
                    <span className="w-4 h-4 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center text-[9px] font-bold shrink-0">1</span>
                    Click <strong className="text-amber-200">&quot;Get key&quot;</strong> next to Gemini or Groq below
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-amber-200/80">
                    <span className="w-4 h-4 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center text-[9px] font-bold shrink-0">2</span>
                    Sign in (Google account for Gemini, email for Groq)
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-amber-200/80">
                    <span className="w-4 h-4 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center text-[9px] font-bold shrink-0">3</span>
                    Copy your key, paste it in the fields below & hit <strong className="text-amber-200">Save</strong>
                  </div>
                </div>
              </div>

              {/* Toggle comparison */}
              <button
                id="byok-compare-toggle"
                type="button"
                onClick={() => setShowComparison(v => !v)}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 text-[11px] text-amber-400/70 hover:text-amber-300 transition-colors border-t border-amber-600/20"
              >
                {showComparison ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {showComparison ? 'Hide' : 'See'} shared vs. own key comparison
              </button>

              {showComparison && (
                <div className="px-4 pb-4 animate-fade-in">
                  <KeyPlanBanner isCustomGemini={status.isCustomGemini} isCustomGroq={status.isCustomGroq} />
                </div>
              )}
            </div>
          )}

          {/* Active status banner — shown when using custom keys */}
          {usingBothCustom && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-300">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
              <div className="space-y-1">
                <p className="font-semibold text-emerald-200">Using your own API keys ✓</p>
                <p className="text-gray-300">
                  Gemini + Groq are connected with your personal keys. You get dedicated rate limits and full privacy.
                </p>
              </div>
            </div>
          )}

          {/* Partial custom key status */}
          {!usingAnyShared && !usingBothCustom && (status.isCustomGemini || status.isCustomGroq) && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-brand-950/30 border border-brand-500/30 text-xs text-brand-300">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-brand-400" />
              <div>
                <p className="font-semibold text-brand-200">Partial custom key active</p>
                <p className="text-gray-400 mt-0.5">Consider adding both keys for the best experience.</p>
              </div>
            </div>
          )}

          {/* Test Audio & Voice button */}
          <div className="rounded-xl bg-surface-900/60 border border-white/8 p-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
                <Volume2 className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-white">Test Interviewer Voice</p>
                <p className="text-[11px] text-gray-400">Test Gemini TTS audio output in your browser</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleTestVoice}
              disabled={testingVoice}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                         bg-brand-500/20 border border-brand-500/40 text-brand-300
                         hover:bg-brand-500/30 hover:text-white transition-all disabled:opacity-50"
            >
              {testingVoice ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Speaking...</>
              ) : (
                <><Sparkles className="w-3.5 h-3.5" /> Speak Sample</>
              )}
            </button>
          </div>

          {/* ── Divider with label ── */}
          <div className="flex items-center gap-3 text-gray-700 text-[10px] uppercase tracking-widest">
            <div className="flex-1 h-px bg-white/6" />
            Your API Keys
            <div className="flex-1 h-px bg-white/6" />
          </div>

          {/* Gemini API Key */}
          <InputRow
            id="gemini-api-key"
            label="Gemini API Key (Voice + Neural TTS + Evaluation)"
            link="https://aistudio.google.com/app/apikey"
            value={geminiKey}
            onChange={setGeminiKey}
            show={showGemini}
            onToggle={() => setShowGemini(p => !p)}
            statusLabel={
              status.isCustomGemini
                ? 'Using your custom key'
                : status.hasGemini
                ? 'Using shared key — add your own above for best experience'
                : null
            }
            placeholder="AIza•••••••••••••••••••••• (paste your key here)"
            hasValue={status.hasGemini}
          />

          {/* Groq API Key */}
          <InputRow
            id="groq-api-key"
            label="Groq API Key (High-Speed LPU Reasoning & STT)"
            link="https://console.groq.com/keys"
            value={groqKey}
            onChange={setGroqKey}
            show={showGroq}
            onToggle={() => setShowGroq(p => !p)}
            statusLabel={
              status.isCustomGroq
                ? 'Using your custom key'
                : status.hasGroq
                ? 'Using shared key — add your own above for best experience'
                : null
            }
            placeholder="gsk_•••••••••••••••••••••••••••• (paste your key here)"
            hasValue={status.hasGroq}
          />

          {/* Key resolution info */}
          <div className="rounded-xl bg-surface-900/60 border border-white/6 px-4 py-3 text-xs text-gray-400 space-y-1">
            <p className="font-semibold text-gray-300 mb-1">How keys are resolved:</p>
            <p className="text-[11px]">1. Custom key entered here (saved in your browser's localStorage)</p>
            <p className="text-[11px]">2. Environment variables (<code className="text-brand-300 font-mono">VITE_GEMINI_API_KEY</code>, <code className="text-brand-300 font-mono">VITE_GROQ_API_KEY</code>)</p>
            <p className="text-[11px]">3. Bundled shared key (default, subject to shared rate limits)</p>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-white/8 flex items-center justify-between gap-3 shrink-0 bg-surface-900/40">
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-gray-500
                       hover:text-red-400 hover:bg-red-950/30 transition-all duration-200"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Reset Custom Keys
          </button>

          <div className="flex gap-2">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-400
                           bg-surface-700 border border-white/10 hover:text-white hover:border-white/20
                           transition-all duration-200"
              >
                Close
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saved}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white
                         bg-brand-gradient shadow-brand-sm hover:shadow-brand-md hover:scale-105
                         active:scale-95 disabled:opacity-70 disabled:cursor-default
                         transition-all duration-200"
            >
              {saved ? (
                <><CheckCircle2 className="w-4 h-4" /> Saved!</>
              ) : (
                <><Save className="w-4 h-4" /> Save Settings</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
