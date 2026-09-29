/**
 * storage.js – Fault-tolerant LocalStorage persistence layer for MOCK PRO.
 *
 * All read/write operations are wrapped in try/catch to gracefully handle:
 *  - Storage quota exceeded
 *  - Private browsing mode restrictions
 *  - Corrupted JSON values
 *
 * Storage Keys:
 *  - mockpro_session:    Target company, candidate metadata, parsed skills, aptitude scores
 *  - mockpro_code:       Latest candidate code, language, execution output, test results
 *  - mockpro_transcripts: Array of voice/text dialogue history across all phases
 *  - mockpro_scorecard:  Diagnostic JSON evaluation output
 */

// ─── Storage Keys ────────────────────────────────────────────────────────────
export const STORAGE_KEYS = {
  SESSION:     'mockpro_session',
  TRANSCRIPTS: 'mockpro_transcripts',
  CODE:        'mockpro_code',
  SCORECARD:   'mockpro_scorecard',
  PHASE2:      'mockpro_phase2',
  APTITUDE:    'mockpro_aptitude',
};

// ─── Generic Helpers ─────────────────────────────────────────────────────────

/**
 * Safely read and JSON-parse a value from localStorage.
 * @param {string} key
 * @param {*} fallback  Value returned when key is absent or parse fails
 * @returns {*}
 */
export function getItem(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[storage] Failed to read "${key}":`, err);
    return fallback;
  }
}

/**
 * Safely JSON-stringify and write a value to localStorage.
 * @param {string} key
 * @param {*} value
 * @returns {boolean} true on success, false on failure
 */
export function setItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error(`[storage] Failed to write "${key}":`, err);
    return false;
  }
}

/**
 * Safely remove a single key from localStorage.
 * @param {string} key
 */
export function removeItem(key) {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.warn(`[storage] Failed to remove "${key}":`, err);
  }
}

// ─── Typed Accessors ─────────────────────────────────────────────────────────

/** @returns {Object} Persisted session data */
export const getSession = () =>
  getItem(STORAGE_KEYS.SESSION, {
    currentPhase: 0,
    candidateData: {
      resumeText:    '',
      parsedSkills:  [],
      targetJD:      '',
      parsedProfile: null,
      targetCompany: null,
    },
    aptitudeResults: null,
    phase2State: null,
  });

/** @param {Object} session */
export const saveSession = (session) => setItem(STORAGE_KEYS.SESSION, session);

/** @returns {Array<{speaker: string, text: string, phase: number, ts: number}>} */
export const getTranscripts = () => getItem(STORAGE_KEYS.TRANSCRIPTS, []);

/** @param {Array} transcripts */
export const saveTranscripts = (transcripts) =>
  setItem(STORAGE_KEYS.TRANSCRIPTS, transcripts);

/** @returns {Object} Persisted code editor state */
export const getCode = () =>
  getItem(STORAGE_KEYS.CODE, {
    language: 'python',
    sourceCode: '',
    executionOutputs: [],
  });

/** @param {Object} codeState */
export const saveCode = (codeState) => setItem(STORAGE_KEYS.CODE, codeState);

/** @returns {Object|null} Persisted scorecard */
export const getScorecard = () => getItem(STORAGE_KEYS.SCORECARD, null);

/** @param {Object} scorecard */
export const saveScorecard = (scorecard) =>
  setItem(STORAGE_KEYS.SCORECARD, scorecard);

/** @returns {Object|null} Persisted Phase 2 (Coding IDE) state */
export const getPhase2State = () => getItem(STORAGE_KEYS.PHASE2, null);

/** @param {Object} phase2State */
export const savePhase2State = (phase2State) =>
  setItem(STORAGE_KEYS.PHASE2, phase2State);

/** @returns {Object|null} Persisted Aptitude state */
export const getAptitudeState = () => getItem(STORAGE_KEYS.APTITUDE, null);

/** @param {Object} aptitudeState */
export const saveAptitudeState = (aptitudeState) =>
  setItem(STORAGE_KEYS.APTITUDE, aptitudeState);

// ─── Session Reset ────────────────────────────────────────────────────────────

/**
 * clearSession – Wipes all MOCK PRO keys from localStorage.
 * Safe to call even if keys don't exist.
 */
export function clearSession() {
  Object.values(STORAGE_KEYS).forEach(removeItem);
  console.info('[storage] Session cleared.');
}

// ─── Mock Data Seed (Ctrl+Shift+D) ───────────────────────────────────────────

export const MOCK_SEED_DATA = {
  session: {
    currentPhase: 2, // Jump straight to Phase 2 (Coding IDE)
    candidateData: {
      resumeText: `Jane Doe\nSoftware Engineer | 3 Years Experience\n\nSkills: React, Node.js, TypeScript, PostgreSQL, Docker, AWS\n\nExperience:\n- Frontend Engineer @ Acme Corp (2023–Present)\n  Built real-time dashboards serving 50K users/day\n- Full-stack Developer @ StartupXYZ (2021–2023)\n  Architected microservice API layer handling 1M req/day`,
      parsedSkills: ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'Docker', 'AWS', 'REST APIs', 'Microservices'],
      targetJD: `Senior Software Engineer – FinTech Platform\n\nWe need someone who:\n- Has 3+ years building scalable web apps\n- Knows React + TypeScript deeply\n- Has experience with distributed systems\n- Can lead technical discussions\n- Writes clean, tested code`,
      parsedProfile: {
        skills: ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'Docker', 'AWS'],
        projects: [{ name: 'Real-time Dashboard', description: 'Serving 50K users/day', tech: ['React', 'WebSockets'] }],
        experience: ['Frontend Engineer @ Acme Corp (2023–Present): Real-time dashboards'],
        targetCompetencies: ['React', 'TypeScript', 'Distributed Systems', 'Technical Leadership'],
        seniorityLevel: 'Senior',
        roleTitle: 'Senior Software Engineer',
      },
      targetCompany: 'Meta',
    },
    aptitudeResults: {
      questions: [],
      userAnswers: [],
      score: 8,
      total: 10,
      percentage: 80,
      totalTime: 120,
      completedAt: Date.now() - 120000,
    },
    phase2State: null,
  },
  transcripts: [
    { speaker: 'AI',        text: 'Welcome to MOCK PRO! I\'ve reviewed your resume. Let\'s begin with some aptitude questions.',  phase: 0, ts: Date.now() - 60000 },
    { speaker: 'Candidate', text: 'Ready to start!', phase: 0, ts: Date.now() - 55000 },
  ],
  code: {
    language: 'python',
    sourceCode: `# Two Sum – Find indices of two numbers that add to target
def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []

print(two_sum([2, 7, 11, 15], 9))  # [0, 1]`,
    executionOutputs: [{ stdout: '[0, 1]', stderr: '', exitCode: 0, ts: Date.now() - 30000 }],
  },
  scorecard: null,
};

/**
 * seedMockData – Populates all storage keys with realistic test data.
 * Sets targetCompany to "Meta" and jumps directly to Phase 2.
 * Triggered via Ctrl+Shift+D hotkey.
 */
export function seedMockData() {
  saveSession(MOCK_SEED_DATA.session);
  saveTranscripts(MOCK_SEED_DATA.transcripts);
  saveCode(MOCK_SEED_DATA.code);
  console.info('[storage] Mock data seeded (Target: Meta, Phase 2). Reload to see changes.');
  return MOCK_SEED_DATA;
}
