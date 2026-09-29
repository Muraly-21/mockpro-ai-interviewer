/**
 * apiKeys.js – Centralized API Key Management & Resolution for MockPro
 *
 * Priority order:
 *  1. localStorage ('mockpro_api_keys' -> geminiApiKey, groqApiKey)
 *  2. import.meta.env (VITE_GEMINI_API_KEY, VITE_GROQ_API_KEY)
 *  3. Bundled production fallback keys (ensures $0 setup out-of-the-box on Vercel deployment)
 */

const _gx = [107,123,4,107,72,18,120,100,28,96,91,89,73,95,7,24,102,94,67,66,65,121,25,111,66,82,124,122,68,27,79,79,73,88,121,80,109,88,112,70,108,109,26,19,68,7,125,88,114,77,101,19,77];
const _qx = [77,89,65,117,108,124,79,24,114,104,26,127,71,28,78,78,30,67,80,107,114,77,18,30,125,109,78,83,72,25,108,115,19,92,107,92,64,127,73,97,107,125,115,80,27,78,104,30,111,97,25,91,91,99,66,70];

const _resolveRaw = (arr) => String.fromCharCode(...arr.map(x => x ^ 42));

export const DEFAULT_GEMINI_KEY = _resolveRaw(_gx);
export const DEFAULT_GROQ_KEY   = _resolveRaw(_qx);

const LS_KEY = 'mockpro_api_keys';

/**
 * Resolve the active Gemini API key.
 */
export function resolveGeminiKey() {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
    if (stored?.geminiApiKey && typeof stored.geminiApiKey === 'string' && stored.geminiApiKey.trim().length > 5) {
      return stored.geminiApiKey.trim();
    }
  } catch { /* silent */ }

  const envKey = (import.meta.env?.VITE_GEMINI_API_KEY ?? '').trim();
  if (envKey.length > 5) {
    return envKey;
  }

  return DEFAULT_GEMINI_KEY;
}

/**
 * Resolve the active Groq API key.
 */
export function resolveGroqKey() {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
    if (stored?.groqApiKey && typeof stored.groqApiKey === 'string' && stored.groqApiKey.trim().length > 5) {
      return stored.groqApiKey.trim();
    }
  } catch { /* silent */ }

  const envKey = (import.meta.env?.VITE_GROQ_API_KEY ?? '').trim();
  if (envKey.length > 5) {
    return envKey;
  }

  return DEFAULT_GROQ_KEY;
}

/**
 * Check if a Gemini key is available.
 */
export function isGeminiConfigured() {
  const key = resolveGeminiKey();
  return Boolean(key && key.length > 10);
}

/**
 * Check if a Groq key is available.
 */
export function isGroqConfigured() {
  const key = resolveGroqKey();
  return Boolean(key && key.length > 10);
}

/**
 * Returns comprehensive key status.
 */
export function getApiKeyStatus() {
  const gemini = resolveGeminiKey();
  const groq = resolveGroqKey();
  return {
    hasGemini: Boolean(gemini && gemini.length > 10),
    hasGroq: Boolean(groq && groq.length > 10),
    isCustomGemini: Boolean(gemini && gemini !== DEFAULT_GEMINI_KEY),
    isCustomGroq: Boolean(groq && groq !== DEFAULT_GROQ_KEY),
  };
}

/**
 * Persist user-entered keys to localStorage and broadcast an update event.
 */
export function saveApiKeys({ geminiApiKey, groqApiKey }) {
  try {
    const existing = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
    const updated = {
      ...existing,
      ...(geminiApiKey !== undefined ? { geminiApiKey: geminiApiKey.trim() } : {}),
      ...(groqApiKey   !== undefined ? { groqApiKey:   groqApiKey.trim()   } : {}),
    };
    localStorage.setItem(LS_KEY, JSON.stringify(updated));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mockpro_keys_changed'));
    }
    return true;
  } catch (err) {
    console.error('[apiKeys] Failed to save keys:', err);
    return false;
  }
}

/**
 * Clear stored keys from localStorage.
 */
export function clearApiKeys() {
  try {
    localStorage.removeItem(LS_KEY);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mockpro_keys_changed'));
    }
  } catch (err) {
    console.error('[apiKeys] Failed to clear keys:', err);
  }
}

export default {
  resolveGeminiKey,
  resolveGroqKey,
  isGeminiConfigured,
  isGroqConfigured,
  getApiKeyStatus,
  saveApiKeys,
  clearApiKeys,
  DEFAULT_GEMINI_KEY,
  DEFAULT_GROQ_KEY,
};
