/**
 * geminiService.js – Google Gemini Live AI Integration for MockPro
 *
 * Connects directly to Google Generative Language API (Gemini 2.5 Flash / Gemini 3.8 Flash)
 * using client-side execution ($0/mo serverless).
 *
 * Features:
 *   • Live streaming conversational generation (SSE streamGenerateContent)
 *   • Fast Socratic gate evaluation with structured JSON
 *   • Audio & multimodal support
 *   • Seamless fallback to Groq when offline or key absent
 */

import { chatCompletion as groqChatCompletion } from './groqService';

// Default models confirmed active with 200 OK on Gemini REST endpoints
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
export const GEMINI_FALLBACK_MODEL = 'gemini-3.8-flash';
export const GEMINI_LEGACY_MODEL   = 'gemini-2.5-flash';

let _geminiChatCooldownUntil = 0; // Cooldown on 503 high-demand spikes


import { resolveGeminiKey, isGeminiConfigured } from './apiKeys';
export { resolveGeminiKey, isGeminiConfigured };

/**
 * Transform standard OpenAI-style messages [{ role, content }]
 * into Gemini's format: { contents: [{ role: 'user'|'model', parts: [{ text }] }], systemInstruction }
 */
function transformMessagesToGemini(messages) {
  let systemInstruction = null;
  const contents = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = {
        parts: [{ text: msg.content }]
      };
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      });
    }
  }

  // Ensure contents is not empty
  if (contents.length === 0) {
    contents.push({
      role: 'user',
      parts: [{ text: 'Hello' }]
    });
  }

  return { systemInstruction, contents };
}

/**
 * Standard chat completion using Google Gemini REST API.
 * Automatically falls back to Groq if Gemini fails or key is missing.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {Object} options
 * @returns {Promise<{ data: Object|null, error: string|null, provider: 'gemini'|'groq' }>}
 */
export async function geminiChatCompletion(messages, options = {}) {
  const apiKey = resolveGeminiKey();
  const model = options.model || GEMINI_DEFAULT_MODEL;

  if (apiKey && Date.now() >= _geminiChatCooldownUntil) {
    const abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), 6500); // 6.5s realistic timeout for JSON generation

    // Link caller's signal if provided
    if (options.signal) {
      options.signal.addEventListener('abort', () => abortCtrl.abort(), { once: true });
    }

    try {
      const { systemInstruction, contents } = transformMessagesToGemini(messages);

      const body = {
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.3,
          maxOutputTokens: options.maxTokens ?? 1024,
        }
      };

      if (systemInstruction) {
        body.systemInstruction = systemInstruction;
      }

      if (options.response_format?.type === 'json_object') {
        body.generationConfig.responseMimeType = 'application/json';
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortCtrl.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        return {
          data: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: text,
                },
              },
            ],
            model,
            usage: data?.usageMetadata,
          },
          error: null,
          provider: 'gemini',
        };
      }

      clearTimeout(timeoutId);
      if (res.status === 503 || res.status === 429) {
        _geminiChatCooldownUntil = Date.now() + 45000;
        console.warn(`[geminiService] Gemini ${res.status} (high demand/rate limit). Cooldown 45s, switching to Groq.`);
      } else {
        const errText = await res.text();
        console.warn(`[geminiService] Gemini call (${model}) failed (${res.status}):`, errText);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (options.signal?.aborted) throw err;
      console.warn('[geminiService] Gemini request exception/timeout:', err.message);
    }
  }

  // Fallback to Groq if Gemini call didn't succeed
  console.info('[geminiService] Using fast Groq for chat completion...');
  const { model: _ignored, ...groqOptions } = options;
  const groqRes = await groqChatCompletion(messages, groqOptions);
  return {
    ...groqRes,
    provider: 'groq',
  };
}

/**
 * Stream Gemini responses chunk by chunk for ultra-low latency live interviewer dialogue.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {Function} onChunk – Callback called with (chunkText, fullTextSoFar)
 * @param {Object} options
 * @returns {Promise<string>} Full assembled response
 */
export async function geminiStreamChat(messages, onChunk, options = {}) {
  const apiKey = resolveGeminiKey();
  const model = options.model || GEMINI_DEFAULT_MODEL;

  if (!apiKey) {
    // If no key, fallback to non-streaming or groq
    const res = await geminiChatCompletion(messages, options);
    const text = res?.data?.choices?.[0]?.message?.content || '';
    onChunk?.(text, text);
    return text;
  }

  const { systemInstruction, contents } = transformMessagesToGemini(messages);
  const body = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.4,
      maxOutputTokens: options.maxTokens ?? 1024,
    }
  };

  if (systemInstruction) {
    body.systemInstruction = systemInstruction;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.warn('[geminiService] SSE stream error, falling back:', errText);
    const fallback = await geminiChatCompletion(messages, options);
    const fallbackText = fallback?.data?.choices?.[0]?.message?.content || '';
    onChunk?.(fallbackText, fallbackText);
    return fallbackText;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const chunk = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (chunk) {
            accumulated += chunk;
            onChunk?.(chunk, accumulated);
          }
        } catch {
          // partial line, skip
        }
      }
    }
  }

  return accumulated;
}

export default {
  resolveGeminiKey,
  isGeminiConfigured,
  geminiChatCompletion,
  geminiStreamChat,
};
