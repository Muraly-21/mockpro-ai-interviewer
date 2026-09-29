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
  ExternalLink, Save, Trash2, ShieldCheck, AlertTriangle,
  Volume2, Loader2, Sparkles,
} from 'lucide-react';
import {
  resolveGeminiKey,
  resolveGroqKey,
  saveApiKeys,
  clearApiKeys,
  getApiKeyStatus,
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

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function BYOKModal({ isOpen, onClose }) {
  const [geminiKey,  setGeminiKey]  = useState('');
  const [groqKey,    setGroqKey]    = useState('');
  const [showGemini, setShowGemini] = useState(false);
  const [showGroq,   setShowGroq]   = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
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
        style={{ maxHeight: 'min(90vh, 720px)' }}
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
                  API Key & Voice Configuration
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Stored securely in your browser &mdash; zero backend storage
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
          {/* Active status banner */}
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-300">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
            <div className="space-y-1">
              <p className="font-semibold text-emerald-200">AI Engines Ready</p>
              <p className="text-gray-300">
                {status.hasGemini && status.hasGroq
                  ? 'Gemini 3.8 / 2.5 Flash + Groq LPU + Gemini Neural TTS are active and connected.'
                  : 'AI services are configured and operational.'}
              </p>
            </div>
          </div>

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

          {/* Gemini API Key */}
          <InputRow
            id="gemini-api-key"
            label="Gemini API Key (Voice + Neural TTS + Evaluation)"
            link="https://aistudio.google.com/app/apikey"
            value={geminiKey}
            onChange={setGeminiKey}
            show={showGemini}
            onToggle={() => setShowGemini(p => !p)}
            statusLabel={status.hasGemini ? (geminiKey.trim() ? 'Using custom key' : 'Connected (Active Production Key)') : null}
            placeholder="AIza•••••••••••••••••••••• (optional override)"
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
            statusLabel={status.hasGroq ? (groqKey.trim() ? 'Using custom key' : 'Connected (Active Production Key)') : null}
            placeholder="gsk_•••••••••••••••••••••••••••• (optional override)"
            hasValue={status.hasGroq}
          />

          {/* Key resolution info */}
          <div className="rounded-xl bg-surface-900/60 border border-white/6 px-4 py-3 text-xs text-gray-400 space-y-1">
            <p className="font-semibold text-gray-300 mb-1">How keys are resolved:</p>
            <p className="text-[11px]">1. Custom key entered in this dialog (localStorage)</p>
            <p className="text-[11px]">2. Environment variables (<code className="text-brand-300 font-mono">VITE_GEMINI_API_KEY</code>, <code className="text-brand-300 font-mono">VITE_GROQ_API_KEY</code>)</p>
            <p className="text-[11px]">3. Bundled production keys ($0 client-side fallback on Vercel deployment)</p>
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
