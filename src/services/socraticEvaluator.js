/**
 * socraticEvaluator.js – Dual-Engine Socratic Gate Verification Service.
 *
 * PRIMARY: Gemini REST API (geminiChatCompletion) for structured evaluation.
 * BACKUP:  Groq REST API (llama-3.3-70b-versatile) with JSON mode for
 *          structured tool call responses when Gemini is unavailable.
 *
 * The evaluator emits structured gate tokens to advance the FSM:
 *   - { approved: true, gateToken: "[APPROVE_CLARIFICATION]", nextState: "APPROACH" }
 *   - { approved: true, gateToken: "[APPROVE_APPROACH]", nextState: "CODING" }
 *
 * Supports company-tagged problem generation for MAANG-standard interviews.
 */

import { chatCompletion, extractContent, DEFAULT_MODEL } from './groqService';
import { geminiChatCompletion, isGeminiConfigured } from './geminiService';

// ─── Engine Mode ────────────────────────────────────────────────────────────

let _engineMode = 'AUTO'; // 'AUTO' | 'GEMINI' | 'BACKUP_MODE'

export function setEvaluatorEngine(mode) {
  _engineMode = mode;
  console.info(`[socraticEvaluator] Engine mode set to: ${mode}`);
}

export function getEvaluatorEngine() {
  return _engineMode;
}

// ─── System Prompts ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT_CLARIFICATION = `You are a friendly, elite Staff Software Engineer at a top tech company conducting the CLARIFICATION & CONSTRAINTS phase of a live coding interview.

CONVERSATION & PERSONA RULES (CRITICAL - SOUND 100% HUMAN & CONTEXT-AWARE):
1. LISTEN & ACKNOWLEDGE: Directly reflect what the candidate just said. If they noted negative numbers, zeroes, empty inputs, or large arrays, praise their instinct naturally (e.g., "Good catch on negative values.", "Spot on regarding the empty array edge case.").
2. NEVER REPEAT QUESTIONS: If the candidate already explained the input constraints or edge cases, NEVER ask for them again!
3. CONVERSATIONAL & PUNCHY: Keep your response to 1-2 natural spoken sentences (maximum 22 words). Speak naturally like a supportive peer sitting next to them. Never output bullet points, markdown headers, or long paragraphs.
4. SINGLE FOCUS: Ask at most ONE specific follow-up question.
5. PROACTIVE GATE APPROVAL: If the candidate demonstrates a clear understanding of the inputs, constraints, or key edge cases, APPROVE them immediately with [APPROVE_CLARIFICATION] to advance them to the approach discussion! Do not stall them.

Respond with ONLY valid JSON:
{
  "approved": true | false,
  "gateToken": "[APPROVE_CLARIFICATION]" | null,
  "nextState": "APPROACH" | null,
  "feedbackPrompt": "1-2 natural, conversational spoken sentences"
}`;

const SYSTEM_PROMPT_APPROACH = `You are a friendly, elite Staff Software Engineer at a top tech company conducting the ALGORITHMIC APPROACH phase of a live coding interview.

CONVERSATION & PERSONA RULES (CRITICAL - SOUND 100% HUMAN & CONTEXT-AWARE):
1. LISTEN & REFLECT: Specifically reference the exact algorithm, data structure, or complexity the candidate proposed (e.g., "A hash map approach is great here.", "Two pointers will give us O(1) extra space.", "Prefix sums avoid repeated recomputation.").
2. DISCUSS TRADEOFFS NATURALLY: If their idea is brute-force O(N^2), gently ask if a hash table or sorting can bring it down to O(N) or O(N log N).
3. NEVER REPEAT QUESTIONS: If they already stated their time and space complexity, do NOT ask "What is your time complexity?".
4. PROACTIVE UNLOCK: If the candidate outlines a viable approach and complexity, APPROVE them immediately with [APPROVE_APPROACH] to unlock the code editor!
5. CONVERSATIONAL & ENCOURAGING: Keep your response to 1-2 natural spoken sentences (maximum 22 words). Encourage them to start coding.

Respond with ONLY valid JSON:
{
  "approved": true | false,
  "gateToken": "[APPROVE_APPROACH]" | null,
  "nextState": "CODING" | null,
  "feedbackPrompt": "1-2 natural, encouraging spoken sentences"
}`;

const SYSTEM_PROMPT_CODING = `You are an elite Staff Software Engineer observing the candidate while they write code in the editor.

RULES:
- Keep responses extremely brief (1 sentence, max 15 words) so the candidate stays in flow.
- If they ask for syntax or library help, answer warmly in one sentence.

Respond with ONLY valid JSON:
{
  "approved": false,
  "gateToken": null,
  "feedbackPrompt": "1 brief, encouraging sentence"
}`;

const SYSTEM_PROMPT_INTERROGATION = `You are an elite Staff Software Engineer conducting the CODE REVIEW & INTERROGATION phase after the candidate submitted their working code.

CONVERSATION & PERSONA RULES (DEEPLY CONTEXT-AWARE & HUMAN):
1. INSPECT THEIR REAL CODE: Review the SUBMITTED CANDIDATE CODE. Specifically name one of their real variables, loops, helper structures, or edge case conditions!
2. PROBING QUESTION: Ask ONE thoughtful, conversational question about a specific trade-off, edge case, memory usage, or how it behaves under massive scale.
3. HUMAN TONE: Speak warmly like an experienced colleague reviewing a pull request. Keep it to 1-2 natural spoken sentences (maximum 24 words).

Respond with ONLY valid JSON:
{
  "approved": false,
  "gateToken": null,
  "feedbackPrompt": "1-2 sentence thoughtful code review question referencing their exact code"
}`;

/**
 * Map FSM state → system prompt
 */
const STATE_PROMPTS = {
  PHASE2_STATE_CLARIFICATION: SYSTEM_PROMPT_CLARIFICATION,
  PHASE2_STATE_APPROACH:      SYSTEM_PROMPT_APPROACH,
  PHASE2_STATE_CODING:        SYSTEM_PROMPT_CODING,
  PHASE2_STATE_INTERROGATION: SYSTEM_PROMPT_INTERROGATION,
};

// ─── MAANG Company Problem Banks ────────────────────────────────────────────

const COMPANY_PROBLEM_TAGS = {
  Google: {
    topics: ['Arrays & Hashing', 'Dynamic Programming', 'Graphs & BFS/DFS', 'Sliding Window', 'Binary Search', 'Trees', 'Tries', 'Heap / Priority Queue'],
    style: 'Google-style interviews focus on algorithmic efficiency, scalability, and clean code. Problems often require optimal time/space complexity.',
  },
  Meta: {
    topics: ['Arrays & Strings', 'Binary Trees', 'Graphs', 'Dynamic Programming', 'Recursion & Backtracking', 'Linked Lists', 'Stacks & Queues', 'Sorting & Searching'],
    style: 'Meta interviews emphasize practical problem-solving, clean code, and communication. Problems often involve string manipulation and tree traversal.',
  },
  Amazon: {
    topics: ['Arrays & Hashing', 'Trees & Graphs', 'Dynamic Programming', 'Greedy Algorithms', 'Linked Lists', 'Stacks & Queues', 'Design', 'String Processing'],
    style: 'Amazon interviews focus on scalable solutions and Leadership Principles. Problems often relate to real-world scenarios like system design.',
  },
  Microsoft: {
    topics: ['Arrays & Strings', 'Linked Lists', 'Trees', 'Dynamic Programming', 'Graphs', 'Stack & Queue', 'Math & Logic', 'Two Pointers'],
    style: 'Microsoft interviews balance algorithmic skills with system design thinking. Problems span a wide range of difficulty.',
  },
  Apple: {
    topics: ['Arrays & Strings', 'Trees & Graphs', 'Dynamic Programming', 'Linked Lists', 'System Design', 'Recursion', 'Bit Manipulation', 'Sorting'],
    style: 'Apple interviews focus on clean, production-quality code and attention to detail. Problems emphasize edge cases and correctness.',
  },
  Uber: {
    topics: ['Graphs & Shortest Paths', 'Arrays & Hashing', 'Dynamic Programming', 'Design', 'Trees', 'Sliding Window', 'Heap', 'Math'],
    style: 'Uber interviews often involve real-world scenarios like ride-matching, surge pricing, and geolocation. Graph problems are especially common.',
  },
  Netflix: {
    topics: ['Arrays & Strings', 'Trees', 'Dynamic Programming', 'System Design', 'Graphs', 'Caching', 'Streaming', 'Data Structures'],
    style: 'Netflix interviews focus on scalable system design and innovative problem-solving. Cultural fit and freedom with responsibility are key.',
  },
};

// ─── Internal: Execute evaluation via chosen engine ─────────────────────────

/**
 * Send messages to Groq REST API as backup engine.
 * Returns structured JSON with gate tokens for FSM transitions.
 */
async function groqBackupEvaluation(messages, signal) {
  const result = await chatCompletion(messages, {
    model: DEFAULT_MODEL,
    temperature: 0.4,
    maxTokens: 512,
    response_format: { type: 'json_object' },
    signal,
  });

  if (result.error) {
    return { data: null, error: result.error };
  }

  try {
    const raw = extractContent(result.data);
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    const parsed = JSON.parse(cleaned);

    return {
      data: {
        approved:       parsed.approved       ?? false,
        gateToken:      parsed.gateToken      ?? null,
        nextState:      parsed.nextState      ?? null,
        feedbackPrompt: parsed.feedbackPrompt  ?? parsed.feedback ?? 'Could you elaborate on that?',
      },
      error: null,
      provider: 'groq',
    };
  } catch (e) {
    console.error('[socraticEvaluator] Groq parse error:', e);
    const rawText = extractContent(result.data);
    return {
      data: {
        approved: false,
        gateToken: null,
        feedbackPrompt: rawText || 'I had trouble processing that. Could you try again?',
      },
      error: null,
      provider: 'groq',
    };
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * evaluateSocratic – Send candidate transcript for Socratic evaluation.
 *
 * Uses Gemini as primary engine. Falls back to Groq llama-3.3-70b-versatile
 * when in BACKUP_MODE or when Gemini fails.
 *
 * @param {Object} params
 * @param {string} params.fsmState        – Current FSM state
 * @param {string} params.candidateText   – Latest candidate speech/text
 * @param {string} params.questionContext – The coding problem being discussed
 * @param {Array<{speaker: string, text: string}>} params.conversationHistory – Prior dialogue
 * @param {string} [params.submittedCode] – Code (for INTERROGATION phase)
 * @param {string} [params.targetCompany] – Target company for contextual evaluation
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{ data: { approved: boolean, gateToken: string|null, feedbackPrompt: string } | null, error: string|null }>}
 */
export async function evaluateSocratic({
  fsmState,
  candidateText,
  questionContext,
  conversationHistory = [],
  submittedCode = '',
  targetCompany = '',
  engineMode,
  signal,
}) {
  const activeMode = engineMode || _engineMode;
  const systemPrompt = STATE_PROMPTS[fsmState];
  if (!systemPrompt) {
    return {
      data: null,
      error: `No Socratic prompt defined for FSM state: ${fsmState}`,
    };
  }

  // Add company context and problem context to the system instruction
  const companyContext = targetCompany
    ? `\n\nTARGET COMPANY: ${targetCompany}. ${COMPANY_PROBLEM_TAGS[targetCompany]?.style ?? 'Evaluate with high technical rigor.'}`
    : '';

  const problemContext = `\n\nCODING PROBLEM CONTEXT:\n${questionContext}\n${
    submittedCode ? `\nSUBMITTED CANDIDATE CODE TO REVIEW:\n\`\`\`\n${submittedCode}\n\`\`\`\n` : ''
  }`;

  // Build clean multi-turn message stream
  const messages = [
    { role: 'system', content: systemPrompt + companyContext + problemContext },
  ];

  // Natural multi-turn dialogue history
  const recentHistory = (conversationHistory || []).slice(-8);
  for (const h of recentHistory) {
    if (!h.text || typeof h.text !== 'string' || h.text.startsWith('[Submitted solution')) continue;
    // Strip previous system banners like "✅ Gate Approved" from history
    const cleanText = h.text.replace(/✅ Gate Approved.*$/m, '').trim();
    if (!cleanText) continue;
    messages.push({
      role: h.speaker === 'AI' ? 'assistant' : 'user',
      content: cleanText,
    });
  }

  // Latest candidate utterance
  if (candidateText?.trim()) {
    messages.push({
      role: 'user',
      content: candidateText.trim(),
    });
  }

  // 1. FORCED GROQ MODE (Presenter or Dev Override)
  if (activeMode === 'BACKUP_MODE') {
    console.info('[socraticEvaluator] Forced GROQ Mode active (llama-3.3-70b-versatile)...');
    const groqRes = await groqBackupEvaluation(messages, signal);
    if (groqRes.data && !groqRes.error) {
      return {
        ...groqRes,
        provider: 'Groq Fallback (llama-3.3-70b-versatile)',
      };
    }
    return groqRes;
  }

  // 2. PRIMARY: Gemini REST API (gemini-2.5-flash) in AUTO or GEMINI mode
  if (isGeminiConfigured() && activeMode !== 'BACKUP_MODE') {
    try {
      console.info(`[socraticEvaluator] Evaluating via Gemini Primary (${GEMINI_DEFAULT_MODEL})...`);
      const result = await geminiChatCompletion(messages, {
        temperature: 0.35,
        maxTokens: 512,
        response_format: { type: 'json_object' },
        signal,
      });

      if (!result.error && result.data) {
        const raw = extractContent(result.data);
        const cleaned = raw
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```\s*$/, '')
          .trim();
        const parsed = JSON.parse(cleaned);

        return {
          data: {
            approved:       parsed.approved       ?? false,
            gateToken:      parsed.gateToken      ?? null,
            nextState:      parsed.nextState      ?? null,
            feedbackPrompt: parsed.feedbackPrompt  ?? parsed.feedback ?? 'Could you walk me through your thinking on that?',
          },
          error: null,
          provider: 'Gemini Primary (gemini-2.5-flash)',
        };
      }
    } catch (e) {
      console.warn('[socraticEvaluator] Gemini evaluation failed, falling back to Groq:', e.message);
    }
  }

  // 3. FALLBACK: Groq LPU (llama-3.3-70b-versatile)
  console.info('[socraticEvaluator] Triggering Groq Fallback Engine (llama-3.3-70b-versatile)...');
  const groqRes = await groqBackupEvaluation(messages, signal);
  if (groqRes.data && !groqRes.error) {
    return {
      ...groqRes,
      provider: 'Groq Fallback (llama-3.3-70b-versatile)',
    };
  }

  // Ultimate fallback
  return {
    data: {
      approved: false,
      gateToken: null,
      feedbackPrompt: 'Could you walk me through your thinking on the constraints and algorithm?',
    },
    error: null,
    provider: 'Heuristic Fallback',
  };
}

/**
 * generateCodingQuestion – Ask the AI to produce a MAANG-tagged coding interview question
 * specifically tailored to the target company's question bank.
 *
 * Uses Groq as primary for sub-2s generation, with auto-failover to Gemini.
 *
 * @param {Object} profile – Candidate profile from extractCandidateProfile()
 * @param {string} targetCompany – Target company (Google, Meta, Amazon, etc.)
 * @param {number} questionNumber – Which question (1 or 2) to avoid duplication
 * @param {string} [previousTopic] – Topic of the previous question to avoid
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ data: Object|null, error: string|null }>}
 */
export async function generateCodingQuestion(profile, targetCompany = '', questionNumber = 1, previousTopic = '', signal) {
  const skills = profile?.skills?.join(', ') || 'general programming';
  const role   = profile?.roleTitle || 'Software Engineer';
  const level  = profile?.seniorityLevel || 'Mid-level';

  const companyData = COMPANY_PROBLEM_TAGS[targetCompany] ?? COMPANY_PROBLEM_TAGS['Google'];
  const company     = targetCompany || 'a top tech company';

  // Pick different topics for Q1 and Q2
  const topicGuidance = questionNumber === 2 && previousTopic
    ? `\nIMPORTANT: The previous question tested "${previousTopic}". You MUST pick a COMPLETELY DIFFERENT algorithmic topic for this question. Choose from: ${companyData.topics.filter(t => t !== previousTopic).join(', ')}.`
    : `Choose a topic from: ${companyData.topics.join(', ')}.`;

  const messages = [
    {
      role: 'system',
      content: `You are an expert technical interviewer generating a ${company} coding problem.
Generate a single, well-defined algorithmic/data structure problem that is a HIGH-FREQUENCY question specifically tagged for ${company} interviews.

${companyData.style}

${topicGuidance}

Difficulty: ${questionNumber === 1 ? 'Medium' : 'Medium-Hard'}

You MUST respond with ONLY valid JSON:
{
  "title": "Problem Title",
  "difficulty": "Medium" or "Hard",
  "companyTags": ["${company}"],
  "topic": "Primary algorithmic topic (e.g., Dynamic Programming, Graphs, etc.)",
  "description": "Full problem description with context and narrative, formatted like LeetCode/HackerRank. Include clear input/output specifications.",
  "examples": "Example 1:\\nInput: ...\\nOutput: ...\\nExplanation: ...\\n\\nExample 2:\\nInput: ...\\nOutput: ...\\nExplanation: ...",
  "testCases": [
    { "id": 1, "input": "Input representation", "expected": "Expected output value" },
    { "id": 2, "input": "Input representation", "expected": "Expected output value" },
    { "id": 3, "input": "Input representation", "expected": "Expected output value" }
  ],
  "constraints": "• Constraint 1\\n• Constraint 2\\n• Constraint 3",
  "timeComplexity": "Expected O(...)",
  "spaceComplexity": "Expected O(...)"
}`,
    },
    {
      role: 'user',
      content: `Candidate skills: ${skills}\nRole: ${role} (${level})\nTarget company: ${company}\nQuestion number: ${questionNumber} of 2\n\nGenerate ONE high-frequency ${company} coding interview problem. Return only JSON.`,
    },
  ];

  let result;
  if (_engineMode === 'GEMINI' && isGeminiConfigured()) {
    console.info('[socraticEvaluator] (Dev Mode) Generating question with Gemini directly...');
    result = await geminiChatCompletion(messages, {
      temperature: 0.6,
      maxTokens: 1000,
      response_format: { type: 'json_object' },
      signal,
    });
  } else {
    // PRIMARY: Groq for fast ~1.5s problem generation
    result = await chatCompletion(messages, {
      model: DEFAULT_MODEL,
      temperature: 0.6,
      maxTokens: 1000,
      response_format: { type: 'json_object' },
      signal,
    });

    // Auto-failover to Gemini if Groq fails
    if (result.error && isGeminiConfigured()) {
      console.warn('[socraticEvaluator] Groq failed for question gen, failing over to Gemini...');
      result = await geminiChatCompletion(messages, {
        temperature: 0.6,
        maxTokens: 1000,
        response_format: { type: 'json_object' },
        signal,
      });
    }
  }

  if (result.error) return result;

  try {
    const raw = extractContent(result.data);
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.testCases) || parsed.testCases.length === 0) {
      parsed.testCases = [
        { id: 1, input: 'Sample Case 1 (Standard Input)', expected: 'Matches Example 1' },
        { id: 2, input: 'Sample Case 2 (Edge Case / Bounds)', expected: 'Matches Example 2' },
        { id: 3, input: 'Sample Case 3 (Scale / Large N)', expected: 'Optimal Execution' },
      ];
    }
    return { data: parsed, error: null };
  } catch {
    return { data: null, error: 'Failed to parse coding question from model.' };
  }
}

export default { evaluateSocratic, generateCodingQuestion, setEvaluatorEngine, getEvaluatorEngine };
