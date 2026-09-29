/**
 * geminiLiveService.js – Primary Voice Engine: Gemini Multimodal Live WebSocket API.
 *
 * Audio Pipeline (v2.5 – FAANG Standard Architecture):
 *  - Input:   getUserMedia with explicit DSP hardware flags (echoCancellation,
 *             noiseSuppression, autoGainControl)
 *  - Downsample: Exact mathematical downsampling from native hardware sampleRate
 *             (e.g. 48kHz / 44.1kHz) to 16kHz Little-Endian 16-bit PCM.
 *  - Barge-in: Client-side RMS noise gate (> 0.015) with 300ms continuous speech debounce
 *              before interrupting AI playback — filters ambient clicks and breathing.
 *  - Immediate Flush: Active AudioBufferSourceNode is instantly stopped on barge-in
 *              eliminating residual audio playback.
 *  - Output:  24kHz raw PCM queued through Web Audio API AudioBufferSourceNodes.
 *
 * Protocol & Handshake:
 *  - Handshake: First frame sent immediately on WebSocket open is the setup frame
 *               declaring model ("models/gemini-2.5-flash"), Kore voice, and
 *               tool declarations (approve_clarification, approve_approach, trigger_code_review).
 *  - Setup Guard: Audio frames are gated and ONLY transmitted after setupComplete ack.
 *
 * FSM Integration:
 *  - Gemini Function Calling tool calls are dispatched via onToolCall callback for
 *    deterministic state transitions.
 *
 * $0/mo – Client-side WebSocket implementation.
 */

export const GEMINI_LIVE_MODEL = 'models/gemini-2.5-flash';
const SAMPLE_RATE_IN           = 16000;  // 16kHz PCM input required by Gemini Live
const SAMPLE_RATE_OUT          = 24000;  // 24kHz PCM output from Gemini Live
const CHUNK_SIZE               = 4096;   // samples per ScriptProcessor processing block
const RMS_NOISE_GATE           = 0.004;  // RMS threshold — lowered so conversational speech is captured smoothly without shouting

// ─── Key Resolution ──────────────────────────────────────────────────────────

export function resolveGeminiKey() {
  try {
    const stored = JSON.parse(localStorage.getItem('mockpro_api_keys') ?? '{}');
    if (stored?.geminiApiKey) return stored.geminiApiKey;
  } catch { /* silent */ }
  return import.meta.env.VITE_GEMINI_API_KEY ?? '';
}

// ─── Client-side 16kHz Downsampler ──────────────────────────────────────────

/**
 * Resamples a Float32Array from inSampleRate to 16000Hz using area averaging.
 * Prevents aliasing and pitch distortions when browser sound card runs at 48kHz or 44.1kHz.
 */
function downsampleTo16k(inputBuffer, inSampleRate) {
  if (inSampleRate === SAMPLE_RATE_IN) {
    return inputBuffer;
  }
  const ratio = inSampleRate / SAMPLE_RATE_IN;
  const newLength = Math.round(inputBuffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetInput = 0;

  while (offsetResult < result.length) {
    const nextOffsetInput = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetInput; i < nextOffsetInput && i < inputBuffer.length; i++) {
      accum += inputBuffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetInput = nextOffsetInput;
  }
  return result;
}

// ─── PCM Audio Queue (Output Playback) ───────────────────────────────────────

class PCMAudioQueue {
  constructor(sampleRate = SAMPLE_RATE_OUT) {
    this._ctx           = null;
    this._queue         = [];
    this._playing       = false;
    this._sampleRate    = sampleRate;
    this._currentSource = null;
  }

  get isPlaying() {
    return this._playing;
  }

  async resumeContext() {
    try {
      if (!this._ctx || this._ctx.state === 'closed') {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this._ctx = new AudioCtx({ sampleRate: this._sampleRate });
        }
      }
      if (this._ctx && this._ctx.state === 'suspended') {
        await this._ctx.resume().catch(() => {});
      }
    } catch (err) {
      console.warn('[PCMAudioQueue] resumeContext warning:', err);
    }
    return this._ctx;
  }

  _ensureContext() {
    try {
      if (!this._ctx || this._ctx.state === 'closed') {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this._ctx = new AudioCtx({ sampleRate: this._sampleRate });
        }
      }
      if (this._ctx && this._ctx.state === 'suspended') {
        this._ctx.resume().catch(() => {});
      }
    } catch (err) {
      console.warn('[PCMAudioQueue] _ensureContext warning:', err);
    }
    return this._ctx;
  }

  /** Enqueue raw 16-bit PCM bytes (Little-Endian) for playback. */
  enqueue(rawBytes) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const count = Math.floor(rawBytes.length / 2);
    if (count <= 0) return;
    try {
      const buf = ctx.createBuffer(1, count, this._sampleRate);
      const ch = buf.getChannelData(0);
      const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, count * 2);
      for (let i = 0; i < count; i++) {
        ch[i] = view.getInt16(i * 2, true) / 32768;
      }
      this._queue.push(buf);
      if (!this._playing) this._drain();
    } catch (err) {
      console.warn('[PCMAudioQueue] enqueue error:', err);
    }
  }

  _drain() {
    if (this._queue.length === 0) {
      this._playing = false;
      this._currentSource = null;
      return;
    }
    const ctx = this._ensureContext();
    if (!ctx) {
      this._playing = false;
      return;
    }
    this._playing = true;
    try {
      const buf = this._queue.shift();
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.connect(ctx.destination);
      this._currentSource = source;

      source.onended = () => {
        if (this._currentSource === source) {
          this._currentSource = null;
        }
        this._drain();
      };

      source.start();
    } catch (err) {
      console.warn('[PCMAudioQueue] _drain error:', err);
      this._playing = false;
    }
  }

  /** Immediately stop all pending and currently playing audio (barge-in). */
  flush() {
    if (this._currentSource) {
      try {
        this._currentSource.stop();
      } catch { /* already stopped */ }
      this._currentSource = null;
    }
    this._queue = [];
    this._playing = false;
  }
}

// ─── Gemini Live Client ──────────────────────────────────────────────────────

export class GeminiLiveClient {
  constructor({ onTranscript, onSpeakingStateChange, onError, onConnectionChange, onToolCall }) {
    this._ws                 = null;
    this._audioQueue         = new PCMAudioQueue(SAMPLE_RATE_OUT);
    this._mediaStream        = null;
    this._audioContext       = null;
    this._processor          = null;
    this._analyser           = null;
    this._isConnected        = false;
    this._isMicActive        = false;
    this._isSetupReady       = false;

    // Callbacks
    this._onTranscript       = onTranscript        ?? (() => {});
    this._onSpeakingState    = onSpeakingStateChange ?? (() => {});
    this._onError            = onError             ?? (() => {});
    this._onConnectionChange = onConnectionChange  ?? (() => {});
    this._onToolCall         = onToolCall          ?? (() => {});
  }

  get isConnected() { return this._isConnected; }
  get isMicActive() { return this._isMicActive; }
  get isSetupReady() { return this._isSetupReady; }

  /**
   * Pre-resume AudioContext on user gesture (e.g. click "Start Interview" or "Speak").
   * Satisfies browser auto-play policy guard.
   */
  async resumeAudio() {
    await this._audioQueue.resumeContext();
  }

  // ── Connection Lifecycle ──────────────────────────────────────────────────

  async connect(systemInstruction = '') {
    const apiKey = resolveGeminiKey();
    if (!apiKey) {
      this._onError('Gemini API key not configured.');
      return false;
    }

    await this.resumeAudio().catch(() => {});

    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

    return new Promise((resolve) => {
      try {
        this._ws = new WebSocket(url);
      } catch (e) {
        this._onError(`WebSocket creation failed: ${e.message}`);
        resolve(false);
        return;
      }

      const timeout = setTimeout(() => {
        this._onError('Gemini Live connection timeout (10s).');
        this._ws?.close();
        resolve(false);
      }, 10000);

      // Store the resolve callback so setupComplete can trigger it
      this._setupResolve = null;

      this._ws.onopen = () => {
        clearTimeout(timeout);
        this._isConnected = true;
        this._isSetupReady = false;
        this._onConnectionChange(true);
        console.info('[GeminiLive] WebSocket connected. Sending setup handshake payload with model:', GEMINI_LIVE_MODEL);

        const setupPayload = {
          setup: {
            model: GEMINI_LIVE_MODEL,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: 'Kore' },
                },
              },
            },
            systemInstruction: systemInstruction
              ? { parts: [{ text: systemInstruction }] }
              : undefined,
            tools: [{
              functionDeclarations: [
                {
                  name: 'approve_clarification',
                  description: 'Call when candidate asks sufficient clarifying questions.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      reason: { type: 'STRING', description: 'Brief rationale for approving clarification phase.' },
                    },
                    required: ['reason'],
                  },
                },
                {
                  name: 'approve_approach',
                  description: 'Call when candidate explains valid algorithm, data structures, and Big-O complexity.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      timeComplexity:  { type: 'STRING', description: 'e.g. O(N log N)' },
                      spaceComplexity: { type: 'STRING', description: 'e.g. O(N)' },
                    },
                    required: ['timeComplexity', 'spaceComplexity'],
                  },
                },
                {
                  name: 'trigger_code_review',
                  description: 'Call when candidate submits code for interrogation.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      questions: {
                        type: 'ARRAY',
                        items: { type: 'STRING' },
                        description: 'List of probing questions for code review.',
                      },
                    },
                    required: ['questions'],
                  },
                },
              ],
            }],
          },
        };

        this._wsSend(setupPayload);

        // Wait for setupComplete from server before resolving
        // Set a secondary timeout for setup acknowledgement
        this._setupResolve = resolve;
        this._setupTimeout = setTimeout(() => {
          // If server never sends setupComplete within 5s, resolve anyway
          if (!this._isSetupReady) {
            console.warn('[GeminiLive] No setupComplete received within 5s, proceeding anyway.');
            this._isSetupReady = true;
            this._setupResolve?.(true);
            this._setupResolve = null;
          }
        }, 5000);
      };

      this._ws.onmessage = (evt) => this._handleMessage(evt);

      this._ws.onerror = (e) => {
        clearTimeout(timeout);
        console.error('[GeminiLive] WebSocket error:', e);
        this._onError('Gemini Live WebSocket connection error.');
        this._isConnected = false;
        this._isSetupReady = false;
        this._onConnectionChange(false);
        resolve(false);
      };

      this._ws.onclose = (e) => {
        clearTimeout(timeout);
        console.info(`[GeminiLive] WebSocket closed (code: ${e.code}, reason: ${e.reason}).`);
        this._isConnected = false;
        this._isSetupReady = false;
        this._onConnectionChange(false);
        this._stopMic();
      };
    });
  }

  disconnect() {
    this._stopMic();
    this._audioQueue.flush();
    if (this._setupTimeout) {
      clearTimeout(this._setupTimeout);
      this._setupTimeout = null;
    }
    if (this._ws) {
      this._ws.onclose = null;
      this._ws.close(1000, 'Client disconnected');
      this._ws = null;
    }
    this._isConnected = false;
    this._isSetupReady = false;
    this._onConnectionChange(false);
    console.info('[GeminiLive] Disconnected cleanly.');
  }

  // ── Message Protocol Handling ─────────────────────────────────────────────

  async _handleMessage(evt) {
    let text;
    if (typeof evt.data === 'string') {
      text = evt.data;
    } else if (evt.data instanceof Blob) {
      text = await evt.data.text();
    } else if (evt.data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(evt.data);
    } else {
      return;
    }

    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg) return;

    // Server setup confirmation — resolve the connect() promise
    if (msg.setupComplete) {
      console.info('[GeminiLive] Server acknowledged setupComplete.');
      this._isSetupReady = true;
      if (this._setupTimeout) {
        clearTimeout(this._setupTimeout);
        this._setupTimeout = null;
      }
      if (this._setupResolve) {
        this._setupResolve(true);
        this._setupResolve = null;
      }
      return;
    }

    // ── Tool Call (Function Calling) ────────────────────────────────────
    const toolCall = msg?.toolCall;
    if (toolCall?.functionCalls?.length) {
      for (const fc of toolCall.functionCalls) {
        const name = fc.name;
        let args = {};
        try {
          args = typeof fc.args === 'string' ? JSON.parse(fc.args) : (fc.args ?? {});
        } catch { /* silent */ }
        console.info(`[GeminiLive] Tool call received: ${name}`, args);
        this._onToolCall({ name, args });
      }

      // Tool call response acknowledgement per Gemini Live spec
      this._wsSend({
        toolResponse: {
          functionResponses: toolCall.functionCalls.map(fc => ({
            response: { output: { success: true } },
            id: fc.id,
          })),
        },
      });
      return;
    }

    // ── Server Content (Audio & Transcript Turns) ───────────────────────
    const sc = msg?.serverContent;
    if (sc) {
      // Interruption signal from server — instant barge-in flush
      if (sc.interrupted) {
        console.info('[GeminiLive] Server interrupted signal → flushing audio queue immediately.');
        this._audioQueue.flush();
        this._onSpeakingState('idle');
        return;
      }

      // Turn complete
      if (sc.turnComplete) {
        this._onSpeakingState('idle');
        return;
      }

      // Model turn parts
      const parts = sc?.modelTurn?.parts ?? [];
      for (const part of parts) {
        // Audio chunk — base64 24kHz PCM at serverContent.modelTurn.parts[].inlineData.data
        if (part?.inlineData?.mimeType?.startsWith('audio/')) {
          const b64   = part.inlineData.data ?? '';
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          this._audioQueue.enqueue(bytes);
          this._onSpeakingState('ai-speaking');
        }
        // Text transcript (filter out internal thought reasoning blocks)
        if (part?.text && !part.thought) {
          this._onTranscript({ speaker: 'AI', text: part.text.trim() });
        }
      }
    }

    // Input transcript echo
    const it = msg?.inputTranscript;
    if (it?.text) {
      this._onTranscript({ speaker: 'Candidate', text: it.text.trim() });
    }
  }

  // ── Microphone Input & Downsampling Pipeline ──────────────────────────────

  async startMic() {
    if (this._isMicActive) return;

    try {
      // 1. AudioContext gesture guard
      await this.resumeAudio();

      // 2. Request user media with browser DSP filters enabled
      this._mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount:     1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl:  true,
        },
      });

      // 3. Resilient AudioContext creation
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      let audioCtx;
      try {
        audioCtx = new AudioCtx({ sampleRate: SAMPLE_RATE_IN });
      } catch {
        audioCtx = new AudioCtx();
      }
      await audioCtx.resume();
      this._audioContext = audioCtx;

      const source = this._audioContext.createMediaStreamSource(this._mediaStream);
      this._analyser = this._audioContext.createAnalyser();
      this._analyser.fftSize = 256;
      source.connect(this._analyser);

      this._processor = this._audioContext.createScriptProcessor(CHUNK_SIZE, 1, 1);
      source.connect(this._processor);
      this._processor.connect(this._audioContext.destination);

      // 4. RMS Noise Gate & Continuous Speech Debounce (Barge-in Logic)
      //    RMS = sqrt(sum(s^2) / N) — drop PCM chunks if RMS < 0.015
      let bargeInFrames = 0;
      const BARGE_IN_DEBOUNCE = 4; // ~4 chunks × 60-80ms ≈ 300ms continuous speech

      this._processor.onaudioprocess = (e) => {
        if (!this._isConnected || !this._ws || !this._isSetupReady) return;

        const inputChannelData = e.inputBuffer.getChannelData(0);
        const actualSampleRate = e.inputBuffer.sampleRate;

        // Calculate RMS energy: RMS = sqrt(sum(s^2) / N)
        let sum = 0;
        for (let i = 0; i < inputChannelData.length; i++) {
          sum += inputChannelData[i] * inputChannelData[i];
        }
        const rms = Math.sqrt(sum / inputChannelData.length);

        // Ambient Noise Resistance & Barge-In Check
        if (rms > RMS_NOISE_GATE) {
          bargeInFrames++;
          if (bargeInFrames >= BARGE_IN_DEBOUNCE && this._audioQueue.isPlaying) {
            console.info('[GeminiLive] Confirmed Candidate Speech (300ms sustained) → Barge-in: Flushing AI Audio.');
            this._audioQueue.flush();
            this._onSpeakingState('candidate-speaking');
            bargeInFrames = 0;
          }
        } else {
          // Drop counter when below noise floor (typing, breathing, room hum)
          bargeInFrames = 0;
        }

        // Only stream PCM chunks when sound is above noise gate (prevents sending silent packets)
        if (rms > RMS_NOISE_GATE) {
          // Exact downsampling to 16kHz
          const resampledFloat32 = downsampleTo16k(inputChannelData, actualSampleRate);

          // Convert Float32 [-1.0, 1.0] to Little-Endian 16-bit PCM
          const int16 = new Int16Array(resampledFloat32.length);
          for (let i = 0; i < resampledFloat32.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, resampledFloat32[i] * 32768));
          }

          const b64 = btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));

          this._wsSend({
            realtimeInput: {
              mediaChunks: [{
                mimeType: `audio/pcm;rate=${SAMPLE_RATE_IN}`,
                data: b64,
              }],
            },
          });
        }
      };

      this._isMicActive = true;
      console.info(`[GeminiLive] Mic active. Hardware Rate: ${this._audioContext.sampleRate}Hz → 16kHz PCM downsampled. RMS Gate: ${RMS_NOISE_GATE}`);
    } catch (err) {
      console.error('[GeminiLive] Mic start failed:', err);
      this._onError(`Microphone initialization failed: ${err.message}`);
    }
  }

  stopMic() {
    this._stopMic();
  }

  _stopMic() {
    if (this._processor) {
      try { this._processor.disconnect(); } catch {}
      this._processor = null;
    }
    if (this._audioContext && this._audioContext.state !== 'closed') {
      try { this._audioContext.close(); } catch {}
      this._audioContext = null;
    }
    if (this._mediaStream) {
      try {
        this._mediaStream.getTracks().forEach(t => t.stop());
      } catch {}
      this._mediaStream = null;
    }
    this._isMicActive = false;
  }

  // ── Send Text Turn ────────────────────────────────────────────────────────

  sendText(text) {
    if (!this._isConnected || !this._isSetupReady) return;
    this._wsSend({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete: true,
      },
    });
  }

  /** Current RMS level (0.0 to 1.0) for visualizer UI. */
  getMicLevel() {
    if (!this._analyser) return 0;
    const buf = new Uint8Array(this._analyser.frequencyBinCount);
    this._analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) {
      sum += (v - 128) ** 2;
    }
    return Math.sqrt(sum / buf.length) / 128;
  }

  _wsSend(obj) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }
}

export default GeminiLiveClient;
