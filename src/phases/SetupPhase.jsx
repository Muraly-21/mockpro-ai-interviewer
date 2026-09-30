




/**
 * SetupPhase.jsx – Phase 0: Candidate Setup (Module 2 – full implementation)
 *
 * Features:
 *  - PDF resume upload with client-side pdfjs-dist text extraction
 *  - Manual paste fallback for resume text
 *  - Target JD text area
 *  - AI-powered profile extraction (skills, projects, competencies) via Groq
 *  - Extracted profile preview chip cloud
 *  - Progress to Phase 1 (Aptitude) only after extraction succeeds
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload, FileText, Target, Sparkles, ArrowRight,
  CheckCircle2, Loader2, AlertCircle, X, Brain,
  FileBadge, ChevronDown, ChevronUp, Paperclip, Key, Zap, Lock, Infinity as InfinityIcon,
} from 'lucide-react';
import { useInterview, PHASES } from '../context/InterviewContext';
import { extractTextFromPDF, isValidPDFFile } from '../utils/pdfParser';
import { extractCandidateProfile } from '../services/groqService';
import { getApiKeyStatus } from '../services/apiKeys';
import BYOKModal from '../components/BYOKModal';

// ─── Domain chip colour map ─────────────────────────────────────────────────
const DOMAIN_COLORS = [
  'bg-brand-900/60 text-brand-300 border-brand-700/40',
  'bg-accent-600/20 text-accent-300 border-accent-500/30',
  'bg-emerald-900/40 text-emerald-300 border-emerald-700/40',
  'bg-sky-900/40 text-sky-300 border-sky-700/40',
  'bg-orange-900/40 text-orange-300 border-orange-700/40',
];

function SkillChip({ label, colorIdx = 0 }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${DOMAIN_COLORS[colorIdx % DOMAIN_COLORS.length]}`}>
      {label}
    </span>
  );
}

// ─── Profile Preview Card ───────────────────────────────────────────────────
function ProfilePreview({ profile }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-4 rounded-xl bg-surface-900/60 border border-emerald-500/20 overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-emerald-900/20 border-b border-emerald-500/20">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold text-emerald-300">Profile Extracted</span>
          <span className="text-xs text-gray-500">
            {profile.roleTitle} · {profile.seniorityLevel}
          </span>
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-gray-500 hover:text-gray-300 transition-colors"
          id="profile-preview-toggle"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Skills cloud — always visible */}
      <div className="px-4 py-3 flex flex-wrap gap-1.5">
        {profile.skills?.slice(0, 10).map((s, i) => (
          <SkillChip key={s} label={s} colorIdx={i % 2 === 0 ? 0 : 2} />
        ))}
        {profile.targetCompetencies?.slice(0, 5).map((c, i) => (
          <SkillChip key={c} label={c} colorIdx={1} />
        ))}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
          {profile.projects?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-1.5">Projects</p>
              <ul className="space-y-1">
                {profile.projects.map((p, i) => (
                  <li key={i} className="text-xs text-gray-400 flex gap-2">
                    <span className="text-brand-400 shrink-0">▸</span>
                    <span><span className="text-gray-300 font-medium">{p.name}</span> — {p.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {profile.experience?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-1.5">Experience</p>
              <ul className="space-y-1">
                {profile.experience.map((e, i) => (
                  <li key={i} className="text-xs text-gray-400 flex gap-2">
                    <span className="text-accent-400 shrink-0">▸</span>
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function SetupPhase() {
  const { candidateData, updateCandidate, setPhase } = useInterview();

  // ── Form state
  const [targetCompany, setTargetCompany] = useState(candidateData?.targetCompany || 'Meta');
  const [isCustomCompany, setIsCustomCompany] = useState(
    Boolean(candidateData?.targetCompany && !['Google', 'Meta', 'Amazon', 'Microsoft', 'Apple', 'Uber', 'Netflix'].includes(candidateData.targetCompany))
  );
  const [customCompanyName, setCustomCompanyName] = useState(
    ['Google', 'Meta', 'Amazon', 'Microsoft', 'Apple', 'Uber', 'Netflix'].includes(candidateData?.targetCompany) ? '' : (candidateData?.targetCompany || '')
  );
  const [resumeText, setResumeText] = useState(candidateData?.resumeText ?? '');
  const [jdText, setJdText] = useState(candidateData?.targetJD ?? candidateData?.jdText ?? '');
  const targetJD = jdText;
  const setTargetJD = setJdText;
  const [skills, setSkills] = useState(
    candidateData?.parsedSkills?.join(', ') ??
    (Array.isArray(candidateData?.skills) ? candidateData.skills.join(', ') : (candidateData?.skills ?? ''))
  );
  const [pdfFile, setPdfFile] = useState(null);

  const [jdFile, setJdFile] = useState(null);
  const [jdLoading, setJdLoading] = useState(false);
  const [jdError, setJdError] = useState(null);
  const [isJdDragging, setIsJdDragging] = useState(false);
  const jdFileInputRef = useRef(null);

  // ── Async status
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractError, setExtractError] = useState(null);
  const [parsedProfile, setParsedProfile] = useState(candidateData?.parsedProfile ?? null);

  const fileInputRef = useRef(null);
  const abortRef = useRef(null);

  // ── BYOK modal state (so users can open keys modal from setup page) ──
  const [showBYOK, setShowBYOK] = useState(false);
  const [keyStatus, setKeyStatus] = useState(() => getApiKeyStatus());
  useEffect(() => {
    const onKeyChange = () => setKeyStatus(getApiKeyStatus());
    window.addEventListener('mockpro_keys_changed', onKeyChange);
    return () => window.removeEventListener('mockpro_keys_changed', onKeyChange);
  }, []);
  const usingSharedKey = (keyStatus.hasGemini && !keyStatus.isCustomGemini) || (keyStatus.hasGroq && !keyStatus.isCustomGroq);

  // ── Sync Controlled Inputs with InterviewContext candidateData (e.g. Ctrl+Shift+D or external hydration) ──
  useEffect(() => {
    if (candidateData) {
      if (candidateData.targetCompany) {
        const isStandard = ['Google', 'Meta', 'Amazon', 'Microsoft', 'Apple', 'Uber', 'Netflix'].includes(candidateData.targetCompany);
        setTargetCompany(candidateData.targetCompany);
        setIsCustomCompany(!isStandard);
        if (!isStandard) setCustomCompanyName(candidateData.targetCompany);
      }
      // Never wipe non-empty local text with empty or stale context data
      if (candidateData.resumeText && candidateData.resumeText !== resumeText) {
        setResumeText(candidateData.resumeText);
      }
      const incomingJD = candidateData.targetJD ?? candidateData.jdText;
      if (incomingJD && incomingJD !== jdText) {
        setJdText(incomingJD);
      }
      const skillsStr = candidateData.parsedSkills?.join(', ')
        ?? (Array.isArray(candidateData.skills) ? candidateData.skills.join(', ') : (candidateData.skills ?? ''));
      if (skillsStr && skillsStr !== skills) {
        setSkills(skillsStr);
      }
      if (candidateData.parsedProfile && candidateData.parsedProfile !== parsedProfile) {
        setParsedProfile(candidateData.parsedProfile);
      }
    }
  }, [candidateData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── PDF Resume Upload handler ───────────────────────────────────────────
  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isValidPDFFile(file)) {
      setPdfError('Please upload a valid PDF file.');
      return;
    }

    setPdfFile(file);
    setPdfError(null);
    setPdfLoading(true);
    setParsedProfile(null);

    const { text, pageCount, error } = await extractTextFromPDF(file);
    setPdfLoading(false);

    if (error) {
      setPdfError(error);
      return;
    }

    setResumeText(text);
    // CRITICAL: Persist to global context immediately so it never vanishes
    updateCandidate({ resumeText: text });
    console.info(`[SetupPhase] Resume PDF extracted: ${pageCount} pages, ${text.length} chars`);
  }, [updateCandidate]);

  // ── JD File Upload handler (PDF or TXT) ─────────────────────────────────
  const handleJDFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setJdFile(file);
    setJdError(null);
    setJdLoading(true);

    try {
      let extractedText = '';
      if (isValidPDFFile(file)) {
        const { text, pageCount, error } = await extractTextFromPDF(file);
        if (error) {
          setJdError(error);
          setJdLoading(false);
          return;
        }
        extractedText = text;
        console.info(`[SetupPhase] JD PDF extracted: ${pageCount} pages, ${text.length} chars`);
      } else {
        // Plain text file (.txt, .md, etc.)
        extractedText = await file.text();
      }

      setJdLoading(false);
      if (!extractedText.trim()) {
        setJdError('No readable text found in file.');
        return;
      }

      setJdText(extractedText);
      // Persist to global context immediately alongside current resumeText
      updateCandidate({ targetJD: extractedText, jdText: extractedText });
    } catch (err) {
      setJdLoading(false);
      setJdError(`Failed to read file: ${err.message}`);
    }
  }, [updateCandidate]);

  // ── Drag & Drop for Resume ──────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await handleFileChange({ target: { files: [file] } });
  }, [handleFileChange]);

  // ── Drag & Drop for JD ──────────────────────────────────────────────────
  const handleJDDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsJdDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await handleJDFileChange({ target: { files: [file] } });
  }, [handleJDFileChange]);

  // ── AI Profile Extraction ────────────────────────────────────────
  const handleExtract = useCallback(async () => {
    if (!resumeText.trim() || !targetJD.trim()) return;

    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setExtractLoading(true);
    setExtractError(null);

    try {
      const { data, error } = await extractCandidateProfile(
        resumeText,
        targetJD,
        controller.signal,
      );

      setExtractLoading(false);

      if (data) {
        setParsedProfile(data);
        if (Array.isArray(data.skills) && data.skills.length > 0) {
          setSkills(data.skills.join(', '));
        }
        // Persist into global state immediately
        updateCandidate({
          resumeText,
          targetJD: jdText,
          jdText,
          parsedSkills: data.skills ?? [],
          parsedProfile: data,
        });
      } else if (error) {
        setExtractError(error);
      }
    } catch (err) {
      setExtractLoading(false);
      if (err.name !== 'AbortError') {
        console.warn('[SetupPhase] Extraction exception, using fallback profile:', err);
      }
    }
  }, [resumeText, targetJD, jdText, updateCandidate]);

  // ── Company Change Handler ──────────────────────────────────────
  const handleSelectCompany = (comp) => {
    setIsCustomCompany(false);
    setTargetCompany(comp);
    updateCandidate({ targetCompany: comp });
  };

  const handleCustomCompanyChange = (val) => {
    setCustomCompanyName(val);
    setTargetCompany(val.trim() || 'Custom');
    updateCandidate({ targetCompany: val.trim() || 'Custom' });
  };

  // ── Proceed to Aptitude ──────────────────────────────────────────
  function handleStart() {
    const finalCompany = isCustomCompany ? (customCompanyName.trim() || 'Tech') : targetCompany;
    // Save whatever we have even if extraction wasn't run
    const skillsList = skills.split(',').map(s => s.trim()).filter(Boolean);
    updateCandidate({
      resumeText,
      targetJD: jdText,
      jdText,
      targetCompany: finalCompany,
      parsedProfile,
      parsedSkills: parsedProfile?.skills ?? (skillsList.length > 0 ? skillsList : candidateData?.parsedSkills ?? []),
    });
    setPhase(PHASES.APTITUDE);
  }

  const hasText = resumeText.trim().length > 50;
  const hasJD = targetJD.trim().length > 30;
  const canExtract = hasText && hasJD && !extractLoading;
  const canProceed = hasText && hasJD;

  const PRESET_COMPANIES = [
    { name: 'Google', icon: '🔍', desc: 'Algorithms & Scalability' },
    { name: 'Meta', icon: '♾️', desc: 'Product & Systems' },
    { name: 'Amazon', icon: '📦', desc: 'Scalable Architecture' },
    { name: 'Microsoft', icon: '🪟', desc: 'Data Structures & Logic' },
    { name: 'Apple', icon: '🍎', desc: 'Production Quality' },
    { name: 'Uber', icon: '🚗', desc: 'Real-Time & Graphs' },
    { name: 'Netflix', icon: '🎬', desc: 'Distributed Systems' },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-slide-up">
      {/* BYOK modal portal */}
      <BYOKModal isOpen={showBYOK} onClose={() => setShowBYOK(false)} />

      {/* ── Hero ── */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-950 border border-brand-700/40 text-brand-300 text-sm font-medium mb-6 animate-fade-in">
          <Sparkles className="w-4 h-4" />
          AI-Powered Interview Simulation
        </div>
        <h1 className="text-4xl sm:text-5xl font-black text-white mb-4 leading-tight">
          Set up your{' '}
          <span className="bg-brand-gradient bg-clip-text text-transparent">interview</span>
        </h1>
        <p className="text-gray-400 text-lg max-w-xl mx-auto">
          Select your target company, upload your resume or paste text, and let AI tailor the Socratic interview to MAANG benchmarks.
        </p>
      </div>

      {/* ── BYOK Awareness Banner — shown when using shared/bundled keys ── */}
      {usingSharedKey && (
        <div
          id="setup-byok-banner"
          className="mb-8 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-950/40 to-surface-800/60 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 shadow-[0_0_30px_rgba(245,158,11,0.08)]"
        >
          {/* Icon */}
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Key className="w-5 h-5 text-amber-400" />
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-200 leading-tight">
              Bring your own API key for the best experience
            </p>
            <p className="text-xs text-amber-300/70 mt-1 leading-relaxed">
              You're currently using a shared key — it may hit rate limits during peak hours.
              Add your own <strong className="text-amber-200">free</strong> Gemini &amp; Groq keys for uninterrupted, private sessions.
            </p>
            {/* Benefit pills */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[
                { icon: InfinityIcon, label: 'No rate limits' },
                { icon: Zap,         label: 'Faster responses' },
                { icon: Lock,        label: 'Private sessions' },
              ].map(({ icon: Icon, label }) => (
                <span key={label} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] font-semibold text-amber-300">
                  <Icon className="w-2.5 h-2.5" />{label}
                </span>
              ))}
            </div>
          </div>

          {/* CTA */}
          <button
            id="setup-add-key-btn"
            type="button"
            onClick={() => setShowBYOK(true)}
            className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold
                       bg-amber-500/20 border border-amber-500/50 text-amber-200
                       hover:bg-amber-500/30 hover:text-white hover:border-amber-400/70
                       transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          >
            <Key className="w-4 h-4" />
            Add Your Key
          </button>
        </div>
      )}

      {/* ── Target Company Selection ── */}
      <div className="mb-8 p-5 rounded-2xl bg-surface-800/90 border border-white/8 shadow-glass">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Target className="w-4 h-4 text-brand-400" />
              Target Company Selection
            </h3>
            <p className="text-xs text-gray-400">
              Drives Phase 2 coding problem selection from high-frequency MAANG question banks.
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-300 self-start sm:self-auto">
            Target: {isCustomCompany ? (customCompanyName || 'Custom') : targetCompany}
          </span>
        </div>

        {/* Company Pills */}
        <div className="flex flex-wrap gap-2 mb-3">
          {PRESET_COMPANIES.map(comp => {
            const isSelected = !isCustomCompany && targetCompany === comp.name;
            return (
              <button
                key={comp.name}
                type="button"
                id={`target-company-${comp.name.toLowerCase()}`}
                onClick={() => handleSelectCompany(comp.name)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all duration-200
                  ${isSelected
                    ? 'bg-brand-600/25 border-brand-500 text-white shadow-brand-sm scale-105'
                    : 'bg-surface-700/60 border-white/8 text-gray-400 hover:text-white hover:border-white/20'
                  }`}
              >
                <span>{comp.icon}</span>
                <span>{comp.name}</span>
              </button>
            );
          })}

          {/* Custom Option Button */}
          <button
            type="button"
            id="target-company-custom-btn"
            onClick={() => {
              setIsCustomCompany(true);
              if (customCompanyName) updateCandidate({ targetCompany: customCompanyName });
            }}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all duration-200
              ${isCustomCompany
                ? 'bg-brand-600/25 border-brand-500 text-white shadow-brand-sm scale-105'
                : 'bg-surface-700/60 border-white/8 text-gray-400 hover:text-white hover:border-white/20'
              }`}
          >
            <span>✨</span>
            <span>Custom Input</span>
          </button>
        </div>

        {/* Custom Input Field when selected */}
        {isCustomCompany && (
          <div className="mt-3 animate-fade-in flex items-center gap-2">
            <input
              id="custom-company-input"
              type="text"
              value={customCompanyName}
              onChange={e => handleCustomCompanyChange(e.target.value)}
              placeholder="Enter company name (e.g. Stripe, Coinbase, Airbnb)..."
              className="flex-1 rounded-xl bg-surface-900 border border-brand-500/40 text-gray-100 text-xs px-3.5 py-2.5 focus:outline-none focus:ring-1 focus:ring-brand-500/40"
            />
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">

        {/* ── LEFT: Resume ── */}
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-300">
            <Upload className="w-4 h-4 text-brand-400" />
            Your Resume / CV
          </label>

          {/* PDF Drop Zone */}
          <div
            id="pdf-drop-zone"
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed
              cursor-pointer transition-all duration-200 py-5
              ${isDragging
                ? 'border-brand-400 bg-brand-950/40 scale-[1.01]'
                : pdfFile
                  ? 'border-emerald-500/50 bg-emerald-900/10'
                  : 'border-white/10 bg-surface-800/60 hover:border-brand-600/50 hover:bg-brand-950/20'
              }
            `}
          >
            <input
              ref={fileInputRef}
              id="resume-file-input"
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={handleFileChange}
            />

            {pdfLoading ? (
              <div className="flex flex-col items-center gap-2 py-2">
                <Loader2 className="w-7 h-7 text-brand-400 animate-spin" />
                <p className="text-sm text-gray-400">Extracting text from PDF…</p>
              </div>
            ) : pdfFile ? (
              <div className="flex items-center gap-3 px-4">
                <FileBadge className="w-7 h-7 text-emerald-400 shrink-0" />
                <div className="text-left min-w-0">
                  <p className="text-sm font-medium text-emerald-300 truncate">{pdfFile.name}</p>
                  <p className="text-xs text-gray-500">{(pdfFile.size / 1024).toFixed(1)} KB · {resumeText.length} chars extracted</p>
                </div>
                <button
                  id="remove-pdf-btn"
                  onClick={e => { e.stopPropagation(); setPdfFile(null); setResumeText(''); setParsedProfile(null); }}
                  className="ml-auto p-1 rounded-lg hover:bg-white/10 text-gray-500 hover:text-red-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                <Paperclip className="w-7 h-7 text-gray-600" />
                <p className="text-sm text-gray-400">
                  <span className="text-brand-400 font-semibold">Click to upload</span> or drag & drop PDF
                </p>
                <p className="text-xs text-gray-600">Resume text extracted instantly, no upload</p>
              </>
            )}
          </div>

          {pdfError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/20 border border-red-500/30 text-red-300 text-xs animate-fade-in">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {pdfError}
            </div>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3 text-gray-700 text-xs">
            <div className="flex-1 h-px bg-white/8" />
            or paste resume text below
            <div className="flex-1 h-px bg-white/8" />
          </div>

          <textarea
            id="resume-text-input"
            value={resumeText}
            onChange={e => {
              const val = e.target.value;
              setResumeText(val);
              setParsedProfile(null);
              updateCandidate({ resumeText: val });
            }}
            placeholder={"Name, experience, skills, education...\n\nPaste or type your resume here"}
            rows={10}
            className="w-full rounded-xl bg-surface-800 border border-white/8 text-gray-200 text-sm font-mono
                       placeholder-gray-600 p-4 resize-none focus:outline-none focus:border-brand-500/60
                       focus:ring-2 focus:ring-brand-500/20 transition-all duration-200"
          />
          <p className="text-xs text-gray-600">{resumeText.length} characters</p>

          {/* Extracted profile preview */}
          {parsedProfile && <ProfilePreview profile={parsedProfile} />}
        </div>

        {/* ── RIGHT: JD + Actions ── */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-300">
              <Target className="w-4 h-4 text-accent-400" />
              Target Job Description
            </label>

            {/* JD File Drop Zone */}
            <div
              id="jd-drop-zone"
              onDragOver={e => { e.preventDefault(); setIsJdDragging(true); }}
              onDragLeave={() => setIsJdDragging(false)}
              onDrop={handleJDDrop}
              onClick={() => jdFileInputRef.current?.click()}
              className={`
                relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed
                cursor-pointer transition-all duration-200 py-5
                ${isJdDragging
                  ? 'border-accent-400 bg-accent-950/40 scale-[1.01]'
                  : jdFile
                    ? 'border-emerald-500/50 bg-emerald-900/10'
                    : 'border-white/10 bg-surface-800/60 hover:border-accent-600/50 hover:bg-accent-950/20'
                }
              `}
            >
              <input
                ref={jdFileInputRef}
                id="jd-file-input"
                type="file"
                accept=".pdf,.txt,.md,application/pdf,text/plain"
                className="hidden"
                onChange={handleJDFileChange}
              />

              {jdLoading ? (
                <div className="flex flex-col items-center gap-2 py-2">
                  <Loader2 className="w-7 h-7 text-accent-400 animate-spin" />
                  <p className="text-sm text-gray-400">Extracting job description…</p>
                </div>
              ) : jdFile ? (
                <div className="flex items-center gap-3 px-4 w-full">
                  <FileBadge className="w-7 h-7 text-emerald-400 shrink-0" />
                  <div className="text-left min-w-0 flex-1">
                    <p className="text-sm font-medium text-emerald-300 truncate">{jdFile.name}</p>
                    <p className="text-xs text-gray-500">{(jdFile.size / 1024).toFixed(1)} KB · {targetJD.length} chars extracted</p>
                  </div>
                  <button
                    id="remove-jd-btn"
                    onClick={e => {
                      e.stopPropagation();
                      setJdFile(null);
                      setJdText('');
                      setParsedProfile(null);
                      updateCandidate({ targetJD: '', jdText: '' });
                    }}
                    className="p-1 rounded-lg hover:bg-white/10 text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <Paperclip className="w-7 h-7 text-gray-600" />
                  <p className="text-sm text-gray-400">
                    <span className="text-accent-400 font-semibold">Click to upload JD</span> or drag & drop (PDF / TXT)
                  </p>
                  <p className="text-xs text-gray-600">Extracts job specifications & required competencies</p>
                </>
              )}
            </div>

            {jdError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/20 border border-red-500/30 text-red-300 text-xs animate-fade-in">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {jdError}
              </div>
            )}

            {/* Divider */}
            <div className="flex items-center gap-3 text-gray-700 text-xs">
              <div className="flex-1 h-px bg-white/8" />
              or paste job description below
              <div className="flex-1 h-px bg-white/8" />
            </div>

            <textarea
              id="jd-input"
              value={targetJD}
              onChange={e => {
                const val = e.target.value;
                setTargetJD(val);
                setParsedProfile(null);
                updateCandidate({ targetJD: val, jdText: val });
              }}
              placeholder={"Role, requirements, responsibilities...\n\nPaste the full job description here"}
              rows={10}
              className="w-full rounded-xl bg-surface-800 border border-white/8 text-gray-200 text-sm
                         placeholder-gray-600 p-4 resize-none focus:outline-none focus:border-accent-500/60
                         focus:ring-2 focus:ring-accent-500/20 transition-all duration-200"
            />
            <p className="text-xs text-gray-600">{targetJD.length} characters</p>
          </div>

          {/* ── Extract Profile Button ── */}
          <button
            id="extract-profile-btn"
            onClick={handleExtract}
            disabled={!canExtract}
            className={`
              flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl
              font-semibold text-sm border transition-all duration-200
              ${canExtract
                ? 'bg-surface-700 border-brand-600/40 text-brand-300 hover:bg-brand-950/60 hover:border-brand-500/60 hover:text-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30'
                : 'bg-surface-800 border-white/5 text-gray-600 cursor-not-allowed'
              }
            `}
          >
            {extractLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                AI is analysing your profile…
              </>
            ) : parsedProfile ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Re-analyse Profile
              </>
            ) : (
              <>
                <Brain className="w-4 h-4" />
                Analyse with AI
                <span className="text-xs opacity-60 ml-1">(recommended)</span>
              </>
            )}
          </button>

          {extractError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-900/20 border border-red-500/30 text-red-300 text-xs animate-fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{extractError} — you can still proceed without AI analysis.</span>
            </div>
          )}

          {/* ── Manual Skills (fallback when no AI extract) ── */}
          {!parsedProfile && (
            <div className="flex flex-col gap-2">
              <label htmlFor="skills-input" className="flex items-center gap-2 text-xs font-semibold text-gray-500">
                <FileText className="w-3.5 h-3.5" />
                Key Skills (optional, comma-separated)
              </label>
              <input
                id="skills-input"
                type="text"
                value={skills}
                onChange={e => setSkills(e.target.value)}
                onBlur={e => updateCandidate({ parsedSkills: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="React, Node.js, TypeScript, PostgreSQL…"
                className="w-full rounded-xl bg-surface-800 border border-white/8 text-gray-200 text-sm
                           placeholder-gray-600 px-4 py-3 focus:outline-none focus:border-emerald-500/60
                           focus:ring-2 focus:ring-emerald-500/20 transition-all duration-200"
              />
            </div>
          )}

          {/* ── Start Interview Button ── */}
          <button
            id="start-interview-btn"
            onClick={handleStart}
            disabled={!canProceed}
            className={`
              mt-auto flex items-center justify-center gap-3 w-full px-6 py-4 rounded-xl
              font-bold text-base transition-all duration-200
              ${canProceed
                ? 'bg-brand-gradient text-white shadow-brand-md hover:shadow-brand-lg hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-brand-500/50'
                : 'bg-surface-700 text-gray-600 cursor-not-allowed border border-white/5'
              }
            `}
          >
            {canProceed ? (
              <>
                <CheckCircle2 className="w-5 h-5" />
                {parsedProfile ? 'Start Aptitude Quiz' : 'Continue to Aptitude'}
                <ArrowRight className="w-5 h-5" />
              </>
            ) : (
              <>Please fill in your resume & job description</>
            )}
          </button>

          {/* ── Tip ── */}
          <div className="p-4 rounded-xl bg-brand-950/40 border border-brand-800/30 flex items-start gap-3">
            <span className="text-lg mt-0.5">💡</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-300 font-medium">Pro Tips</p>
              <ul className="text-xs text-gray-500 mt-1 space-y-1 list-disc list-inside">
                <li>Upload a PDF to extract text automatically (client-side, no upload)</li>
                <li>Click &quot;Analyse with AI&quot; to let the model map your skills to the JD</li>
                <li>
                  <button
                    type="button"
                    onClick={() => setShowBYOK(true)}
                    className="text-brand-400 hover:text-brand-300 underline underline-offset-2 transition-colors"
                  >
                    Add your own free API key
                  </button>
                  {' '}for uninterrupted, rate-limit-free sessions
                </li>
                <li>
                  Press{' '}
                  <kbd className="px-1.5 py-0.5 rounded bg-surface-700 text-gray-300 font-mono text-[10px] border border-white/10">
                    Ctrl+Shift+D
                  </kbd>{' '}
                  to instantly load mock data
                </li>
              </ul>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
