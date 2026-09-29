/**
 * codeRunner.js – Polyglot Client-Side Code Execution Engine.
 *
 * Supports:
 *   • Python     → Pyodide (WASM) with AI execution fallback
 *   • JavaScript → Isolated Web Worker with console capture & return expression capture
 *   • C++        → JSCPP interpreter with AI execution fallback
 *   • Java       → JVM Execution Simulator (Gemini / Groq)
 *
 * Every execution is wrapped in a Promise.race() against an 8000ms
 * timeout to catch infinite loops before they crash the browser tab.
 *
 * Returns: { stdout, stderr, exitCode, duration }
 */

import { geminiChatCompletion } from './geminiService.js';

const TIMEOUT_MS = 8000;

// ─── Runtime Caches ─────────────────────────────────────────────────────────
let pyodideInstance = null;
let pyodideLoadPromise = null;
let jscppLoaded = false;

// ─── Timeout Guard ──────────────────────────────────────────────────────────
function createTimeoutGuard() {
  let timerId;
  const promise = new Promise((_, reject) => {
    timerId = setTimeout(
      () => reject(new Error('Execution Timeout: 8s Limit Exceeded')),
      TIMEOUT_MS,
    );
  });
  return { promise, cancel: () => clearTimeout(timerId) };
}

// ─── AI Execution Engine Fallback (Universal) ──────────────────────────────

/**
 * Robustly extract a JSON object from an AI response string.
 * Handles markdown fences, trailing garbage, and partial responses.
 */
function safeParseJSON(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Strip markdown code fences
  let cleaned = raw
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim();

  // Try a direct parse first
  try { return JSON.parse(cleaned); } catch { /* continue */ }

  // Find the first { ... } block in the response (handles trailing prose)
  const startIdx = cleaned.indexOf('{');
  const endIdx   = cleaned.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const jsonSlice = cleaned.slice(startIdx, endIdx + 1);
    try { return JSON.parse(jsonSlice); } catch { /* continue */ }
  }

  // Last resort: try to build a minimal valid response from the partial content
  console.warn('[codeRunner] safeParseJSON: could not extract valid JSON from response, using fallback');
  return null;
}

async function runCodeWithAI(language, code) {
  try {
    const messages = [
      {
        role: 'system',
        content: `You are a high-performance ${language} runtime execution engine.
Simulate the execution of the provided ${language} source code precisely.
You MUST respond with ONLY a valid JSON object with these exact keys:
{
  "stdout": "<exact printed output, preserving newlines with \\n, or empty string if no output>",
  "stderr": "<compilation errors or runtime exceptions, or empty string>",
  "exitCode": 0
}
Critical rules:
- Do NOT include any explanation, markdown, or text outside the JSON.
- If there is a runtime error, set exitCode to 1 and stderr to the error message.
- For System.out.println / print() statements, output the exact values to stdout.`
      },
      {
        role: 'user',
        content: `Execute this ${language} code:\n\n${code}`,
      }
    ];

    const result = await geminiChatCompletion(messages, {
      temperature: 0.05,
      maxTokens: 2048,   // Increased: 512 was too small for large program output
      response_format: { type: 'json_object' }
    });

    if (result?.error) {
      return { stdout: '', stderr: `Execution engine error: ${result.error}`, exitCode: 1 };
    }

    const raw = result?.data?.choices?.[0]?.message?.content || '';
    const parsed = safeParseJSON(raw);

    if (!parsed) {
      // Could not parse — surface the raw response as stdout so the user sees something
      return {
        stdout: raw || '',
        stderr: raw ? '' : 'AI execution engine returned an empty response.',
        exitCode: raw ? 0 : 1,
      };
    }

    return {
      stdout:   typeof parsed.stdout   === 'string' ? parsed.stdout   : String(parsed.stdout   ?? ''),
      stderr:   typeof parsed.stderr   === 'string' ? parsed.stderr   : String(parsed.stderr   ?? ''),
      exitCode: typeof parsed.exitCode === 'number' ? parsed.exitCode : (parsed.exitCode ? 1 : 0),
    };
  } catch (err) {
    return {
      stdout: '',
      stderr: err.message || `${language} execution simulation failed`,
      exitCode: 1
    };
  }
}

// ─── Python (Pyodide with AI fallback) ──────────────────────────────────────
async function loadPyodideRuntime() {
  if (pyodideInstance) return pyodideInstance;
  if (pyodideLoadPromise) return pyodideLoadPromise;

  pyodideLoadPromise = new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Pyodide CDN load timeout (3.5s)'));
    }, 3500);

    try {
      if (!window.loadPyodide) {
        await new Promise((res, rej) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js';
          script.onload = res;
          script.onerror = () => rej(new Error('Failed to load Pyodide from CDN'));
          document.head.appendChild(script);
        });
      }

      const instance = await window.loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/',
      });
      clearTimeout(timeout);
      pyodideInstance = instance;
      resolve(instance);
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });

  return pyodideLoadPromise;
}

async function runPython(code) {
  try {
    const pyodide = await loadPyodideRuntime();

    // Capture stdout/stderr in memory
    pyodide.runPython(`
import sys, io
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
    `);

    await pyodide.runPythonAsync(code);
    const stdout = pyodide.runPython('sys.stdout.getvalue()');
    const stderr = pyodide.runPython('sys.stderr.getvalue()');
    return { stdout: stdout || '', stderr: stderr || '', exitCode: 0 };
  } catch (err) {
    // If Pyodide CDN failed to load or runtime failed, fall back to AI simulation
    console.warn('[codeRunner] Pyodide local execution failed, falling back to AI execution engine:', err.message);
    return await runCodeWithAI('python', code);
  }
}

function runJavaScript(code) {
  return new Promise((resolve) => {
    // If Web Workers or Blob URLs are blocked/unavailable, run in isolated Function scope
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL === 'undefined') {
      const logs = [];
      const errors = [];
      const customConsole = {
        log: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
        error: (...args) => errors.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
        warn: (...args) => logs.push('[warn] ' + args.map(a => String(a)).join(' ')),
        info: (...args) => logs.push('[info] ' + args.map(a => String(a)).join(' ')),
      };
      try {
        const fn = new Function('console', code);
        const res = fn(customConsole);
        if (logs.length === 0 && res !== undefined) {
          logs.push(typeof res === 'object' ? JSON.stringify(res) : String(res));
        }
        return resolve({ stdout: logs.join('\n'), stderr: errors.join('\n'), exitCode: errors.length > 0 ? 1 : 0 });
      } catch (err) {
        return resolve({ stdout: logs.join('\n'), stderr: err.message, exitCode: 1 });
      }
    }

    try {
      const workerCode = `
      const logs = [];
      const errors = [];
      const originalConsole = {
        log: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
        error: (...args) => errors.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
        warn: (...args) => logs.push('[warn] ' + args.map(a => String(a)).join(' ')),
        info: (...args) => logs.push('[info] ' + args.map(a => String(a)).join(' ')),
      };
      const console = originalConsole;

      try {
        const __fn = new Function('console', ${JSON.stringify(`
          try {
            ${code}
          } catch (e) {
            console.error(e.message);
          }
        `)});
        const result = __fn(console);
        if (logs.length === 0 && result !== undefined) {
          logs.push(typeof result === 'object' ? JSON.stringify(result) : String(result));
        }
        self.postMessage({ stdout: logs.join('\\n'), stderr: errors.join('\\n'), exitCode: errors.length > 0 ? 1 : 0 });
      } catch (err) {
        errors.push(err.message);
        self.postMessage({ stdout: logs.join('\\n'), stderr: errors.join('\\n'), exitCode: 1 });
      }
    `;

      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);

      worker.onmessage = (e) => {
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve(e.data);
      };

      worker.onerror = (err) => {
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve({ stdout: '', stderr: err.message || 'Worker error', exitCode: 1 });
      };
    } catch (err) {
      console.warn('[codeRunner] Worker instantiation failed, executing directly:', err.message);
      const logs = [];
      const errors = [];
      const customConsole = {
        log: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
        error: (...args) => errors.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
        warn: (...args) => logs.push('[warn] ' + args.map(a => String(a)).join(' ')),
        info: (...args) => logs.push('[info] ' + args.map(a => String(a)).join(' ')),
      };
      try {
        const fn = new Function('console', code);
        const res = fn(customConsole);
        if (logs.length === 0 && res !== undefined) {
          logs.push(typeof res === 'object' ? JSON.stringify(res) : String(res));
        }
        resolve({ stdout: logs.join('\n'), stderr: errors.join('\n'), exitCode: errors.length > 0 ? 1 : 0 });
      } catch (e) {
        resolve({ stdout: logs.join('\n'), stderr: e.message, exitCode: 1 });
      }
    }
  });
}

// ─── C++ (JSCPP with AI fallback) ──────────────────────────────────────────
async function loadJSCPP() {
  if (jscppLoaded && window.JSCPP) return;

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/JSCPP@2.1.2/dist/JSCPP.es5.min.js';
    script.onload = () => { jscppLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Failed to load JSCPP from CDN'));
    document.head.appendChild(script);
  });
}

async function runCpp(code) {
  try {
    await loadJSCPP();

    if (!window.JSCPP) {
      return await runCodeWithAI('cpp', code);
    }

    const config = {
      stdio: { write: () => {} },
      unsigned_overflow: 'warn',
    };

    let output = '';
    config.stdio.write = (s) => { output += s; };

    window.JSCPP.run(code, '', config);
    return { stdout: output, stderr: '', exitCode: 0 };
  } catch (err) {
    console.warn('[codeRunner] JSCPP runtime failed, falling back to AI execution:', err.message);
    return await runCodeWithAI('cpp', code);
  }
}

// ─── Java (JVM Execution Engine) ───────────────────────────────────────────
async function runJava(code) {
  return await runCodeWithAI('java', code);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Language → runner mapping */
const RUNNERS = {
  python:     runPython,
  javascript: runJavaScript,
  cpp:        runCpp,
  java:       runJava,
};

/**
 * executeCode – Run code in the specified language with an 8s timeout guard.
 *
 * @param {string} language  – 'python' | 'javascript' | 'cpp' | 'java'
 * @param {string} codeString – Source code to execute
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number, duration: number }>}
 */
export async function executeCode(language, codeString) {
  const runner = RUNNERS[language];
  if (!runner) {
    return {
      stdout: '',
      stderr: `Unsupported language: "${language}". Supported: ${Object.keys(RUNNERS).join(', ')}`,
      exitCode: 1,
      duration: 0,
    };
  }

  const start = performance.now();
  const timeout = createTimeoutGuard();

  try {
    const result = await Promise.race([
      runner(codeString),
      timeout.promise,
    ]);

    timeout.cancel();
    const duration = Math.round(performance.now() - start);

    return {
      stdout:   result.stdout   ?? '',
      stderr:   result.stderr   ?? '',
      exitCode: result.exitCode ?? 0,
      duration,
    };
  } catch (err) {
    timeout.cancel();
    const duration = Math.round(performance.now() - start);

    return {
      stdout: '',
      stderr: err.message || 'Execution failed',
      exitCode: 1,
      duration,
    };
  }
}

/**
 * getSupportedLanguages – Returns list of supported language identifiers.
 */
export function getSupportedLanguages() {
  return Object.keys(RUNNERS);
}

/** Check if the Pyodide WASM runtime is fully loaded and initialized */
export function isPyodideReady() {
  return pyodideInstance !== null;
}

/** Preload Pyodide WASM runtime ahead of time (resilient with 3.5s timeout) */
export async function preloadPyodide() {
  try {
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(true), 3500));
    await Promise.race([loadPyodideRuntime(), timeoutPromise]);
    return true;
  } catch (err) {
    console.info('[codeRunner] Pyodide preload timed out or failed; AI execution fallback will be used:', err.message);
    return true; // Always return true so user is never blocked
  }
}

export default { executeCode, getSupportedLanguages, isPyodideReady, preloadPyodide };
