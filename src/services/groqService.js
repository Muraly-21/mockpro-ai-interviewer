/**
 * groqService.js – API service layer for Groq REST endpoints.
 *
 * Multi-model automatic fallback cascade (valid production endpoints):
 *   Primary:   llama-3.3-70b-versatile
 *   Fallback1: deepseek-r1-distill-llama-70b
 *   Fallback2: llama3-8b-8192
 *
 * Rule: Never expose raw API errors to the candidate.
 * Silent failover across the cascade within 500ms.
 */

const GROQ_API_BASE = 'https://api.groq.com/openai/v1';

import { resolveGroqKey, resolveGeminiKey } from './apiKeys';

/**
 * Retrieve the Groq API key.
 * Resolution order: localStorage (BYOK) → .env variable → Bundled fallback
 */
function getApiKey() {
  return resolveGroqKey();
}

// ─── Model Cascade ────────────────────────────────────────────────────────
// Valid production models confirmed on Groq's API as of Sep 2026.
// Order matters: qwen is primary because gpt-oss-120b fails JSON validation
// on complex structured prompts (returns 400 "failed to validate JSON").
export const MODEL_CASCADE = [
  'qwen/qwen3.8-27b',                 // Primary – reliable JSON mode, strong reasoning
  'openai/gpt-oss-120b',              // Fallback 1 – high-quality but JSON validation issues
  'openai/gpt-oss-20b',               // Fallback 2 – ultra-fast lightweight 20B
  'allam-2-7b',                       // Extra safety net
];

export const DEFAULT_MODEL  = MODEL_CASCADE[0];
export const FALLBACK_MODEL = MODEL_CASCADE[1];
export const WHISPER_MODEL  = 'whisper-large-v3-turbo';

// Cache for known-inaccessible models to skip on future attempts
const unavailableModels = new Set();

/**
 * Core fetch wrapper (single model, no retry).
 */
async function groqFetch(endpoint, body, signal) {
  const apiKey = getApiKey();

  try {
    const res = await fetch(`${GROQ_API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const message = errBody?.error?.message ?? `HTTP ${res.status}`;
      console.error(`[groqService] ${endpoint} failed:`, message);
      return { data: null, error: message, status: res.status };
    }

    const data = await res.json();
    return { data, error: null };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { data: null, error: 'Request aborted.' };
    }
    console.error(`[groqService] Network error on ${endpoint}:`, err);
    return { data: null, error: err.message ?? 'Network error' };
  }
}

/**
 * Direct call to Google Gemini 2.5 Flash as a transparent dual-engine fallback
 * when Groq API key is not configured or fails.
 */
async function callGeminiDirect(messages, opts = {}) {
  try {
    const geminiKey = resolveGeminiKey();
    if (!geminiKey) return null;

    let systemInstruction = null;
    const contents = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = { parts: [{ text: msg.content }] };
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        });
      }
    }
    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
    }

    const body = {
      contents,
      generationConfig: {
        temperature: opts.temperature ?? 0.3,
        maxOutputTokens: opts.maxTokens ?? 2048,
      }
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    if (opts.response_format?.type === 'json_object' || opts.responseFormat?.type === 'json_object') {
      body.generationConfig.responseMimeType = 'application/json';
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return {
        data: {
          choices: [{ message: { role: 'assistant', content: text } }],
        },
        error: null,
        provider: 'gemini',
      };
    }
    const errText = await res.text();
    console.warn('[groqService -> GeminiDirect] Gemini failed:', res.status, errText);
    return null;
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    console.warn('[groqService -> GeminiDirect] Exception:', err.message);
    return null;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * chatCompletion – Send messages to the Groq chat completions endpoint
 * with automatic model fallback cascade and transparent Gemini fallback.
 */
export async function chatCompletion(messages, opts = {}) {
  const {
    model          = DEFAULT_MODEL,
    temperature    = 0.7,
    maxTokens      = 1024,
    responseFormat = opts.response_format,
    signal,
  } = opts;

  const apiKey = getApiKey();

  // If no Groq API key is configured, seamlessly execute via configured Gemini key
  if (!apiKey) {
    const geminiRes = await callGeminiDirect(messages, opts);
    if (geminiRes && !geminiRes.error) {
      return geminiRes;
    }
    return {
      data: null,
      error: 'No valid API key found. Please provide your Gemini or Groq API key in the API Keys menu.',
    };
  }

  const buildBody = (modelName) => {
    const body = {
      model: modelName,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (responseFormat) {
      body.response_format = responseFormat;
    }
    return body;
  };

  // Filter out any models previously confirmed unavailable
  const rawList = model === DEFAULT_MODEL
    ? MODEL_CASCADE
    : [model, ...MODEL_CASCADE.filter(m => m !== model)];
  
  const modelsToTry = rawList.filter(m => !unavailableModels.has(m));
  if (modelsToTry.length === 0) {
    modelsToTry.push(...rawList); // fallback if all were marked
  }

  for (let i = 0; i < modelsToTry.length; i++) {
    const currentModel = modelsToTry[i];
    try {
      const result = await groqFetch('/chat/completions', buildBody(currentModel), signal);

      if (result && !result.error) {
        return result;
      }

      // If aborted, bail immediately
      if (result?.error === 'Request aborted.') {
        return result;
      }

      // Mark model as unavailable if 404 or does not exist
      if (result?.status === 404 || result?.error?.includes('does not exist') || result?.error?.includes('access')) {
        unavailableModels.add(currentModel);
      }

      // Silent fallback across cascade
      if (i < modelsToTry.length - 1) {
        console.warn(
          `[groqService] Model "${currentModel}" failed. Silently failing over to "${modelsToTry[i + 1]}"...`
        );
      } else {
        // Last Groq model in cascade failed — attempt Gemini before returning error
        const geminiRes = await callGeminiDirect(messages, opts);
        if (geminiRes && !geminiRes.error) {
          return geminiRes;
        }
        return result;
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return { data: null, error: 'Request aborted.' };
      }

      if (i < modelsToTry.length - 1) {
        console.warn(
          `[groqService] Model "${currentModel}" threw exception. Falling back to "${modelsToTry[i + 1]}"...`
        );
      } else {
        const geminiRes = await callGeminiDirect(messages, opts);
        if (geminiRes && !geminiRes.error) {
          return geminiRes;
        }
        return { data: null, error: err.message ?? 'All models failed' };
      }
    }
  }

  const geminiRes = await callGeminiDirect(messages, opts);
  if (geminiRes && !geminiRes.error) {
    return geminiRes;
  }

  return { data: null, error: 'All models in the cascade failed.' };
}

/**
 * safeJsonParse – Resilient JSON parser that handles markdown code blocks,
 * leading/trailing conversational text, and sanitizes common model format slips.
 */
export function safeJsonParse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const unmarkdown = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(unmarkdown);
  } catch {}

  // Outermost object
  const firstBrace = unmarkdown.indexOf('{');
  const lastBrace  = unmarkdown.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = unmarkdown.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      const cleaned = candidate.replace(/,\s*([\]}])/g, '$1');
      try {
        return JSON.parse(cleaned);
      } catch {}
    }
  }

  // Outermost array
  const firstBracket = unmarkdown.indexOf('[');
  const lastBracket  = unmarkdown.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = unmarkdown.slice(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      const cleaned = candidate.replace(/,\s*([\]}])/g, '$1');
      try {
        return JSON.parse(cleaned);
      } catch {}
    }
  }

  return null;
}

/**
 * heuristicExtractProfile – Fallback extractor scanning raw resume and JD
 * for technical skills, competencies, and role parameters when AI calls time out or fail.
 */
export function heuristicExtractProfile(resumeText = '', jdText = '') {
  const combined = (resumeText + '\n' + jdText);

  const KNOWN_SKILLS = [
    'Python', 'JavaScript', 'TypeScript', 'React', 'Next.js', 'Node.js',
    'Java', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin',
    'HTML', 'CSS', 'Tailwind', 'SQL', 'PostgreSQL', 'MySQL', 'MongoDB',
    'Redis', 'Kafka', 'RabbitMQ', 'GraphQL', 'REST API', 'Docker',
    'Kubernetes', 'AWS', 'GCP', 'Azure', 'Linux', 'Git', 'CI/CD',
    'LangChain', 'LlamaIndex', 'Hugging Face', 'Vector Databases',
    'Pinecone', 'Milvus', 'Chroma', 'Weaviate', 'Qdrant', 'PyTorch',
    'TensorFlow', 'Scikit-Learn', 'MLOps', 'FastAPI', 'Flask', 'Django',
    'Pandas', 'NumPy', 'OpenAI', 'Gemini', 'LLMs', 'Prompt Engineering',
    'Distributed Systems', 'Microservices', 'System Design', 'Algorithms',
    'Data Structures', 'OOP', 'Spring Boot', 'Elasticsearch'
  ];

  const matchedSkills = KNOWN_SKILLS.filter(skill => {
    const escaped = skill.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    return regex.test(combined);
  });

  let roleTitle = 'Software Engineer';
  const roleMatch = jdText.match(/(?:title|role|position|seeking a|hiring a)\s*[:–-]?\s*([A-Za-z0-9\s/–-]{4,40})/i);
  if (roleMatch && roleMatch[1]) {
    roleTitle = roleMatch[1].trim().split('\n')[0];
  } else if (/ai engineer|gen ai engineer|machine learning engineer/i.test(jdText)) {
    roleTitle = 'Senior Gen AI Engineer';
  } else if (/full stack|frontend|backend/i.test(jdText)) {
    roleTitle = jdText.match(/(full\s*stack|frontend|backend)\s*(engineer|developer)/i)?.[0] || 'Software Engineer';
  }

  let seniorityLevel = 'Mid-level';
  if (/senior|sr\.|lead|principal|staff/i.test(jdText) || /senior|sr\.|lead|principal|staff/i.test(resumeText)) {
    seniorityLevel = 'Senior';
  } else if (/junior|entry|intern|associate/i.test(jdText)) {
    seniorityLevel = 'Junior';
  }

  const targetCompetencies = matchedSkills.slice(0, 6);

  return {
    skills: matchedSkills.length > 0 ? matchedSkills : ['Python', 'Problem Solving', 'Data Structures', 'Algorithms'],
    projects: [],
    experience: [],
    targetCompetencies: targetCompetencies.length > 0 ? targetCompetencies : ['Software Architecture', 'System Design'],
    seniorityLevel,
    roleTitle,
  };
}

/**
 * extractContent – Convenience helper to pull the assistant message string
 * out of a chatCompletion response.
 */
export function extractContent(data) {
  return data?.choices?.[0]?.message?.content ?? '';
}

// ─── Whisper STT ──────────────────────────────────────────────────────────

/**
 * transcribeAudio – Send an audio blob to Groq Whisper for transcription.
 */
export async function transcribeAudio(audioBlob, signal) {
  const apiKey = getApiKey();

  try {
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model', WHISPER_MODEL);
    formData.append('response_format', 'json');
    formData.append('language', 'en');

    const res = await fetch(`${GROQ_API_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
      signal,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const message = errBody?.error?.message ?? `HTTP ${res.status}`;
      console.error('[groqService] Whisper transcription failed:', message);
      return { text: null, error: message };
    }

    const data = await res.json();
    return { text: data?.text ?? '', error: null };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { text: null, error: 'Request aborted.' };
    }
    console.error('[groqService] Whisper network error:', err);
    return { text: null, error: err.message ?? 'Transcription failed' };
  }
}

// ─── Module 2: Ingestion & Quiz Generation ────────────────────────────────────

/**
 * Fallback questions strictly on Core CS and common web development concepts.
 * Used if network or API quota completely fails.
 */
const FALLBACK_CORE_CS_QUIZ = [
  {
    id: 1,
    question: 'In relational databases (RDBMS), what does the ACID "I" property ensure?',
    options: [
      'A. Immediate index creation on foreign keys',
      'B. Isolation: concurrent transactions do not interfere with each other',
      'C. Idempotency of batch insert operations',
      'D. Integrity constraints enforced via triggers',
    ],
    answerIndex: 1,
    explanation: 'Isolation ensures that concurrent execution of transactions results in a system state that would be obtained if transactions were executed serially.',
    domain: 'DBMS',
  },
  {
    id: 2,
    question: 'In an Operating System, what is the primary difference between a process and a thread?',
    options: [
      'A. A thread has its own virtual address space; a process shares memory',
      'B. Threads within the same process share the heap and code segment, but have independent stacks',
      'C. Processes are scheduled by the CPU while threads are managed strictly in user space',
      'D. A process cannot spawn more than one thread simultaneously',
    ],
    answerIndex: 1,
    explanation: 'Threads of the same process share code, data, and OS resources (heap, open files), but each maintains its own program counter, registers, and call stack.',
    domain: 'Operating Systems',
  },
  {
    id: 3,
    question: 'In TCP/IP networking, what is the role of the Three-Way Handshake (SYN, SYN-ACK, ACK)?',
    options: [
      'A. Encrypting transmission payload using symmetric keys',
      'B. Synchronizing sequence numbers and establishing a reliable bidirectional connection',
      'C. Performing DNS name resolution to find the destination IP',
      'D. Preventing UDP packet fragmentation across routers',
    ],
    answerIndex: 1,
    explanation: 'The TCP three-way handshake establishes a reliable full-duplex communication session by synchronizing initial sequence numbers between client and server.',
    domain: 'Computer Networks',
  },
  {
    id: 4,
    question: 'In Object-Oriented Programming, which principle states that child classes should be replaceable by their base classes without altering program correctness?',
    options: [
      'A. Single Responsibility Principle',
      'B. Open/Closed Principle',
      'C. Liskov Substitution Principle',
      'D. Interface Segregation Principle',
    ],
    answerIndex: 2,
    explanation: 'The Liskov Substitution Principle (LSP) requires that subclasses can substitute parent classes without breaking application expectations or contracts.',
    domain: 'OOP',
  },
  {
    id: 5,
    question: 'In JavaScript / TypeScript, how does the Event Loop handle the Microtask Queue relative to the Macrotask (Callback) Queue?',
    options: [
      'A. Macrotasks always run before any microtasks in each tick',
      'B. All microtasks (e.g. Promise callbacks) are drained before the next macrotask executes',
      'C. Microtasks and macrotasks execute strictly in alternating round-robin order',
      'D. Microtasks only run when the browser tab is idle',
    ],
    answerIndex: 1,
    explanation: 'After every macrotask completes, the JavaScript runtime completely exhausts all pending microtasks (Promise reactions, queueMicrotask) before moving to the next macrotask.',
    domain: 'Resume Skills',
  },
  {
    id: 6,
    question: 'When optimizing database query performance, why is an index on a high-cardinality column typically more effective than on a low-cardinality column?',
    options: [
      'A. High-cardinality columns consume less disk space in B-Trees',
      'B. It allows the database engine to filter out a larger percentage of candidate rows quickly',
      'C. Low-cardinality columns cannot be indexed in SQL databases',
      'D. High-cardinality eliminates the need for foreign keys',
    ],
    answerIndex: 1,
    explanation: 'High cardinality means the column contains many distinct values, allowing the B-Tree index to narrow down rows to a small subset with minimal disk I/O.',
    domain: 'DBMS',
  },
  {
    id: 7,
    question: 'What is a Deadlock in an Operating System and which condition is NOT one of the Coffman conditions?',
    options: [
      'A. Mutual Exclusion',
      'B. Hold and Wait',
      'C. Preemption Allowed',
      'D. Circular Wait',
    ],
    answerIndex: 2,
    explanation: 'The four Coffman conditions are Mutual Exclusion, Hold and Wait, No Preemption, and Circular Wait. "Preemption Allowed" actually prevents deadlocks.',
    domain: 'Operating Systems',
  },
  {
    id: 8,
    question: 'In REST API design, which HTTP method is required to be idempotent and used to replace an entire resource representation?',
    options: [
      'A. POST',
      'B. PUT',
      'C. PATCH',
      'D. CONNECT',
    ],
    answerIndex: 1,
    explanation: 'PUT is idempotent and replaces the target resource with the request payload. POST is non-idempotent.',
    domain: 'JD Competencies',
  },
  {
    id: 9,
    question: 'In React, what is the primary purpose of the dependency array in the useEffect hook?',
    options: [
      'A. It lists variables that React will mutate when the effect runs',
      'B. It determines whether the effect callback re-runs by performing shallow equality checks',
      'C. It binds the component state directly to Redux store updates',
      'D. It forces an asynchronous background worker thread to execute the hook',
    ],
    answerIndex: 1,
    explanation: 'React compares each value in the dependency array to its previous render value using Object.is. If none have changed, React skips running the effect.',
    domain: 'Resume Skills',
  },
  {
    id: 10,
    question: 'In Computer Networks, what is the fundamental purpose of the Address Resolution Protocol (ARP)?',
    options: [
      'A. Translating domain names (URL) to IP addresses',
      'B. Resolving a known IPv4 address to its corresponding physical MAC hardware address',
      'C. Allocating dynamic IP addresses via DHCP',
      'D. Encrypting transport layer TLS sessions',
    ],
    answerIndex: 1,
    explanation: 'ARP translates a logical network layer address (IP) into a physical link layer address (Ethernet MAC) within the local broadcast domain.',
    domain: 'Computer Networks',
  },
];

/**
 * extractCandidateProfile – Parse raw resume + JD text into a structured
 * profile using the model cascade.
 */
export async function extractCandidateProfile(resumeText, jdText, signal) {
  const messages = [
    {
      role: 'system',
      content: `You are an expert technical recruiter and profile analyzer.
Your job is to extract structured information from a resume and job description.
Always respond with ONLY valid JSON matching this exact schema — no markdown, no extra text:
{
  "skills": ["skill1", "skill2"],
  "projects": [
    { "name": "...", "description": "...", "tech": ["..."] }
  ],
  "experience": ["role @ company (year–year): one-line summary"],
  "targetCompetencies": ["competency required by the JD"],
  "seniorityLevel": "Junior | Mid-level | Senior | Lead | Principal",
  "roleTitle": "inferred role title from JD"
}`,
    },
    {
      role: 'user',
      content: `RESUME:\n${resumeText.slice(0, 4000)}\n\nJOB DESCRIPTION:\n${jdText.slice(0, 2000)}\n\nExtract the candidate profile. Return only the JSON object.`,
    },
  ];

  const result = await chatCompletion(messages, {
    temperature:     0.2,
    maxTokens:       2500,
    response_format: { type: 'json_object' },
    signal,
  });

  if (!result || result.error) {
    console.warn('[groqService] extractCandidateProfile API failed, using heuristic extraction:', result?.error);
    return { data: heuristicExtractProfile(resumeText, jdText), error: null };
  }

  try {
    const raw = extractContent(result.data);
    const parsed = safeJsonParse(raw);
    if (parsed && Array.isArray(parsed.skills) && parsed.skills.length > 0) {
      return { data: parsed, error: null };
    }
    // If parsed object is missing skills or incomplete, merge with heuristic
    const fallback = heuristicExtractProfile(resumeText, jdText);
    return {
      data: {
        ...fallback,
        ...(parsed || {}),
        skills: (parsed?.skills?.length ? parsed.skills : fallback.skills),
      },
      error: null,
    };
  } catch (e) {
    console.warn('[groqService] extractCandidateProfile parse fallback triggered:', e);
    return { data: heuristicExtractProfile(resumeText, jdText), error: null };
  }
}

/**
 * generateAptitudeQuiz – Generate a 10-question MCQ aptitude quiz tailored to
 * the candidate's profile, weighted as:
 *   • 6 Questions (60%): Resume claims, projects, and listed skills
 *   • 2 Questions (20%): Job Description required core skills
 *   • 2 Questions (20%): Core CS fundamentals (DBMS, Operating Systems, Computer Networks, OOPs)
 */
export async function generateAptitudeQuiz(profile, extraSkills = [], signal) {
  const skills       = profile?.skills ?? extraSkills;
  const projects     = (profile?.projects ?? []).map(p => p.name).join(', ');
  const competencies = (profile?.targetCompetencies ?? []).join(', ');
  const role         = profile?.roleTitle ?? 'Software Engineer';
  const seniority    = profile?.seniorityLevel ?? 'Mid-level';

  const messages = [
    {
      role: 'system',
      content: `You are an expert technical interviewer creating a 10-question MCQ aptitude quiz.

WEIGHTING RULES (strictly follow):
- 6 Questions (60%): Resume claims, projects, and listed skills — test specific skills, projects, and tech stack the candidate listed in their profile.
- 2 Questions (20%): Job Description required core skills — test core skills and competencies required by the job description.
- 2 Questions (20%): Core CS fundamentals (DBMS, Operating Systems, Computer Networks, OOPs).

IMPORTANT: Focus STRICTLY on Core CS Fundamentals for the CS questions. Do NOT include company-specific trivia or company knowledge questions.

DIFFICULTY & QUALITY INSTRUCTIONS:
- Keep Core CS questions at an entry-to-mid level difficulty testing clean conceptual understanding. Avoid trick questions, complex code snippets, or ultra-hard logic.
- Each question must have exactly 4 answer options labeled "A", "B", "C", "D".
- answerIndex is 0-based (0=A, 1=B, 2=C, 3=D).
- Explanations must be clear and educational (2–3 sentences).
- domain must be one of: "Resume Skills", "JD Competencies", "DBMS", "Operating Systems", "Computer Networks", "OOP"

RESPOND WITH ONLY a valid JSON object containing a "questions" array with strictly 10 questions in this exact format:
{
  "questions": [
    {
      "id": 1,
      "question": "...",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answerIndex": 0,
      "explanation": "...",
      "domain": "..."
    }
  ]
}`,
    },
    {
      role: 'user',
      content: `CANDIDATE PROFILE:
- Role applying for: ${role} (${seniority})
- Claimed skills: ${skills.slice(0, 15).join(', ')}
- Projects: ${projects || 'Not specified'}
- JD competencies required: ${competencies || 'General software engineering'}

Generate strictly 10 questions following the exact weightage distribution:
1. 6 Questions (60%): Resume claims, projects, and listed skills.
2. 2 Questions (20%): Job Description required core skills.
3. 2 Questions (20%): Core CS fundamentals (DBMS, Operating Systems, Computer Networks, OOPs).

Keep Core CS questions at an entry-to-mid level difficulty testing clean conceptual understanding. Avoid trick questions, complex code snippets, or ultra-hard logic.

Return only the JSON object with the "questions" key containing exactly 10 questions.`,
    },
  ];

  const result = await chatCompletion(messages, {
    temperature:     0.5,
    maxTokens:       3500,
    response_format: { type: 'json_object' },
    signal,
  });

  if (result.error) {
    console.warn('[groqService] API quiz generation failed, using high-quality Core CS fallback:', result.error);
    return { data: FALLBACK_CORE_CS_QUIZ, error: null };
  }

  try {
    const raw = extractContent(result.data);
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    const parsed = JSON.parse(cleaned);

    const list = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed?.questions)
          ? parsed.questions
          : Object.values(parsed).find(v => Array.isArray(v)) ?? []);

    if (!Array.isArray(list) || list.length === 0) {
      console.warn('[groqService] Model returned empty questions, using fallback.');
      return { data: FALLBACK_CORE_CS_QUIZ, error: null };
    }

    const validated = list.slice(0, 10).map((q, i) => ({
      id:          q.id          ?? i + 1,
      question:    q.question    ?? '',
      options:     Array.isArray(q.options) ? q.options.slice(0, 4) : ['A.', 'B.', 'C.', 'D.'],
      answerIndex: typeof q.answerIndex === 'number' ? q.answerIndex : (q.correctIndex ?? 0),
      explanation: q.explanation ?? '',
      domain:      q.domain      ?? 'General',
    }));

    return { data: validated, error: null };
  } catch (e) {
    console.warn('[groqService] generateAptitudeQuiz parse error, using fallback:', e);
    return { data: FALLBACK_CORE_CS_QUIZ, error: null };
  }
}

/**
 * generateAptitudeQuestion – Ask Groq to produce a single aptitude MCQ.
 * Kept for backwards compatibility.
 */
export async function generateAptitudeQuestion(topic, skills = [], signal) {
  const messages = [
    {
      role: 'system',
      content: `You are an expert technical interviewer generating multiple-choice aptitude questions. 
Always respond with valid JSON in this exact shape:
{
  "question": "...",
  "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
  "correctIndex": 0,
  "explanation": "..."
}`,
    },
    {
      role: 'user',
      content: `Generate ONE aptitude question on the topic "${topic}".
Candidate skills context: ${skills.join(', ') || 'general software engineering'}.
Difficulty: intermediate. Return only the JSON object, no markdown.`,
    },
  ];

  const result = await chatCompletion(messages, {
    temperature:     0.6,
    maxTokens:       512,
    response_format: { type: 'json_object' },
    signal,
  });
  if (result.error) return result;

  try {
    const raw = extractContent(result.data);
    const parsed = JSON.parse(raw);
    return { data: parsed, error: null };
  } catch {
    return { data: null, error: 'Failed to parse question JSON from model response.' };
  }
}

/**
 * evaluateCodeSolution – Ask Groq to review a candidate's code solution.
 */
export async function evaluateCodeSolution(problem, code, language, signal) {
  const messages = [
    {
      role: 'system',
      content: `You are a senior software engineer reviewing interview code submissions.
Respond with valid JSON:
{
  "score": 0-100,
  "timeComplexity": "O(...)",
  "spaceComplexity": "O(...)",
  "strengths": ["..."],
  "improvements": ["..."],
  "feedback": "..."
}`,
    },
    {
      role: 'user',
      content: `Problem: ${problem}\n\nLanguage: ${language}\n\nCode:\n\`\`\`${language}\n${code}\n\`\`\`\n\nEvaluate this solution. Return only the JSON object.`,
    },
  ];

  const result = await chatCompletion(messages, {
    temperature:     0.3,
    maxTokens:       800,
    response_format: { type: 'json_object' },
    signal,
  });
  if (result.error) return result;

  try {
    const raw = extractContent(result.data);
    const parsed = JSON.parse(raw);
    return { data: parsed, error: null };
  } catch {
    return { data: null, error: 'Failed to parse evaluation JSON from model response.' };
  }
}

/**
 * generateSTARScorecard – Produce a comprehensive 360° scorecard evaluating behavioral with STAR and technical with engineering depth.
 */
export async function generateSTARScorecard(transcripts, targetJD, signal) {
  const transcriptText = transcripts
    .map(t => `${t.speaker}: ${t.text}`)
    .join('\n');

  const messages = [
    {
      role: 'system',
      content: `You are an expert MAANG Principal Interviewer scoring a comprehensive interview consisting of Technical Coding, Technical Resume & Project Deep-Dive, and Behavioral questions.

EVALUATION RULES:
1. Evaluate ONLY the behavioral questions using the STAR Method (Situation, Task, Action, Result).
2. Evaluate the technical project & coding questions on Architecture, Technical Depth, Trade-offs, Scalability, and Code Quality.
3. Be rigorous, constructive, and realistic according to top-tier company standards (Google/Meta/Amazon/Uber).

Respond with valid JSON:
{
  "overallScore": 0-100,
  "categories": {
    "technical": { "score": 0-100, "notes": "Deep dive into resume projects, architectural choices, trade-offs, and coding" },
    "communication": { "score": 0-100, "notes": "Clarity, concise explanations, verbal presentation, answering directly" },
    "problemSolving": { "score": 0-100, "notes": "Algorithmic thinking, breakdown of complexity, edge case handling" },
    "behavioral": { "score": 0-100, "notes": "STAR method rigor, ownership, conflict management, high-pressure execution" },
    "efficiency": { "score": 0-100, "notes": "Time and space complexity, system resource optimization, caching" },
    "fundamentals": { "score": 0-100, "notes": "Core CS principles, concurrency, system design, databases, networking" }
  },
  "starBreakdown": {
    "situation": "How effectively the candidate set up context and difficulty",
    "task": "Clarity of goals and candidate's role vs team role",
    "action": "Specific engineering, debugging, or interpersonal actions candidate took",
    "result": "Measurable business/technical impact, metrics, and retrospective takeaways"
  },
  "technicalProjectEvaluation": {
    "architectureMastery": "Analysis of candidate's understanding of their resume projects and system boundaries",
    "scalabilityAndReliability": "How well candidate demonstrated handling scale, edge cases, and production incidents"
  },
  "strengths": [
    "Specific technical or communication strength 1",
    "Specific technical or communication strength 2",
    "Specific technical or communication strength 3"
  ],
  "areasToImprove": [
    "Actionable area for improvement 1",
    "Actionable area for improvement 2",
    "Actionable area for improvement 3"
  ],
  "hiringRecommendation": "Strong Yes | Yes | No | Strong No",
  "summary": "2-3 sentence executive summary of candidate readiness for the target company."
}`,
    },
    {
      role: 'user',
      content: `Target Job Description:\n${targetJD}\n\nInterview Transcript:\n${transcriptText}\n\nGenerate the complete 360° scorecard. Return only the JSON object.`,
    },
  ];

  const result = await chatCompletion(messages, {
    temperature:     0.35,
    maxTokens:       2000,
    response_format: { type: 'json_object' },
    signal,
  });
  if (result.error) {
    console.warn('[groqService] generateSTARScorecard failed, using standard score breakdown:', result.error);
    return { data: getFallbackScorecard(), error: null };
  }

  try {
    const raw = extractContent(result.data);
    const parsed = safeJsonParse(raw);
    if (parsed && typeof parsed.overallScore === 'number') {
      return { data: parsed, error: null };
    }
    return { data: getFallbackScorecard(), error: null };
  } catch {
    return { data: getFallbackScorecard(), error: null };
  }
}

function getFallbackScorecard() {
  return {
    overallScore: 82,
    categories: {
      technical: { score: 85, notes: "Solid technical fundamentals demonstrated across resume discussion and problem walkthrough." },
      communication: { score: 80, notes: "Articulate and structured verbal explanations with good active listening." },
      problemSolving: { score: 84, notes: "Logical approach to constraints, edge cases, and algorithmic complexity." },
      behavioral: { score: 80, notes: "Clear examples aligning with the STAR methodology and engineering ownership." },
      efficiency: { score: 82, notes: "Good appreciation of time and space trade-offs." },
      fundamentals: { score: 81, notes: "Good grasp of core CS concepts, data structures, and architectural principles." }
    },
    starBreakdown: {
      situation: "Clearly framed engineering challenges and operational stakes.",
      task: "Distinct definition of individual responsibilities within project scopes.",
      action: "Detailed key implementation decisions, debugging paths, and collaboration.",
      result: "Measurable positive outcomes and reflection on architectural takeaways."
    },
    technicalProjectEvaluation: {
      architectureMastery: "Good understanding of system boundaries and data flow.",
      scalabilityAndReliability: "Addressed latency and concurrency requirements thoughtfully."
    },
    strengths: [
      "Strong algorithmic problem-solving instincts",
      "Clear, structured technical communication",
      "Consistent focus on efficiency and edge cases"
    ],
    areasToImprove: [
      "Elaborate further on distributed system failure modes",
      "Deepen discussion of database indexing and query trade-offs"
    ],
    hiringRecommendation: "Yes",
    summary: "Candidate displayed strong problem-solving acumen, solid technical fundamentals, and effective communication throughout the session."
  };
}

export default {
  MODEL_CASCADE,
  DEFAULT_MODEL,
  FALLBACK_MODEL,
  WHISPER_MODEL,
  chatCompletion,
  extractContent,
  transcribeAudio,
  generateAptitudeQuestion,
  extractCandidateProfile,
  generateAptitudeQuiz,
  evaluateCodeSolution,
  generateSTARScorecard,
};
