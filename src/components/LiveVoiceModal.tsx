import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  RefreshCw,
  Send,
  Square,
  Volume2,
  X,
} from 'lucide-react';

interface LiveVoiceModalProps {
  isOpen: boolean;
  contextDestination?: string;
  contextListing?: string;
  onClose: () => void;
}

interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

type VoiceStatus = 'idle' | 'connecting' | 'live' | 'error';
type ConnectionMode = 'realtime' | 'fallback';

function downsampleBuffer(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate = 16000,
): Float32Array {
  if (inputSampleRate === targetSampleRate || inputSampleRate <= targetSampleRate) {
    return input;
  }
  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.round(input.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < input.length; i += 1) {
      accum += input[i];
      count += 1;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function float32ToBase64Pcm(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to encode recorded audio.'));
    reader.readAsDataURL(blob);
  });
}

async function safeResumeContext(ctx: AudioContext | null): Promise<void> {
  if (!ctx || ctx.state !== 'suspended') return;
  try {
    await Promise.race([
      ctx.resume(),
      new Promise<void>((resolve) => setTimeout(resolve, 350)),
    ]);
  } catch {
    // Ignore autoplay restriction errors; user can unlock on next click
  }
}

export const LiveVoiceModal: React.FC<LiveVoiceModalProps> = ({
  isOpen,
  contextDestination,
  contextListing,
  onClose,
}) => {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('realtime');
  const [isMuted, setIsMuted] = useState(false);
  const [micAvailable, setMicAvailable] = useState(true);
  const [micNotice, setMicNotice] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [isRecordingFallback, setIsRecordingFallback] = useState(false);
  const [isFallbackSending, setIsFallbackSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const zeroGainRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const activeAudioNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const isMutedRef = useRef<boolean>(false);
  const isLiveReadyRef = useRef<boolean>(false);
  const intentionalCloseRef = useRef<boolean>(false);
  const sessionIdRef = useRef<number>(0);
  const handshakeTimerRef = useRef<number | null>(null);
  const queuedPromptRef = useRef<string | null>(null);
  const lastMicUiUpdateRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const fallbackAudioUrlRef = useRef<string | null>(null);
  const transcriptsRef = useRef<TranscriptEntry[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    transcriptsRef.current = transcripts;
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  const clearHandshakeTimer = useCallback(() => {
    if (handshakeTimerRef.current !== null) {
      window.clearTimeout(handshakeTimerRef.current);
      handshakeTimerRef.current = null;
    }
  }, []);

  const stopFallbackPlayback = useCallback(() => {
    if (fallbackAudioRef.current) {
      try {
        fallbackAudioRef.current.pause();
        fallbackAudioRef.current.src = '';
      } catch {
        // Ignore audio stop errors
      }
      fallbackAudioRef.current = null;
    }
    if (fallbackAudioUrlRef.current) {
      URL.revokeObjectURL(fallbackAudioUrlRef.current);
      fallbackAudioUrlRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore speechSynthesis cancel errors
      }
    }
  }, []);

  const stopScheduledPlayback = useCallback(() => {
    for (const node of activeAudioNodesRef.current) {
      try {
        node.stop();
      } catch {
        // Ignore already stopped audio nodes
      }
    }
    activeAudioNodesRef.current.clear();
    stopFallbackPlayback();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
    setIsModelSpeaking(false);
  }, [stopFallbackPlayback]);

  const stopMicCapture = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore recorder stop errors
      }
    }
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
    setIsRecordingFallback(false);

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (zeroGainRef.current) {
      zeroGainRef.current.disconnect();
      zeroGainRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    setMicLevel(0);
  }, []);

  const releaseMediaAndSockets = useCallback(() => {
    clearHandshakeTimer();
    stopScheduledPlayback();
    stopMicCapture();

    if (inputCtxRef.current) {
      void inputCtxRef.current.close().catch(() => undefined);
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      void outputCtxRef.current.close().catch(() => undefined);
      outputCtxRef.current = null;
    }
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        intentionalCloseRef.current = true;
        try {
          ws.close();
        } catch {
          // Ignore WebSocket close error
        }
      }
    }
    isLiveReadyRef.current = false;
    setIsModelSpeaking(false);
    setIsFallbackSending(false);
  }, [clearHandshakeTimer, stopMicCapture, stopScheduledPlayback]);

  const cleanupSession = useCallback(() => {
    sessionIdRef.current += 1;
    intentionalCloseRef.current = true;
    queuedPromptRef.current = null;
    releaseMediaAndSockets();
    setStatus('idle');
    setConnectionMode('realtime');
    setMicNotice(null);
  }, [releaseMediaAndSockets]);

  useEffect(() => {
    if (!isOpen) {
      cleanupSession();
    }
  }, [isOpen, cleanupSession]);

  useEffect(() => {
    return () => cleanupSession();
  }, [cleanupSession]);

  const scheduleAudioChunk = useCallback((base64Audio: string) => {
    let outCtx = outputCtxRef.current;
    if (!outCtx) {
      try {
        outCtx = new AudioContext({ sampleRate: 24000 });
      } catch {
        outCtx = new AudioContext();
      }
      outputCtxRef.current = outCtx;
      nextStartTimeRef.current = outCtx.currentTime;
    }

    if (outCtx.state === 'suspended') {
      void outCtx.resume().catch(() => undefined);
    }

    const samples = base64PcmToFloat32(base64Audio);
    if (samples.length === 0) return;

    const audioBuffer = outCtx.createBuffer(1, samples.length, 24000);
    audioBuffer.getChannelData(0).set(samples);

    const source = outCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outCtx.destination);

    const now = outCtx.currentTime;
    const startAt = Math.max(now + 0.01, nextStartTimeRef.current);
    nextStartTimeRef.current = startAt + audioBuffer.duration;

    activeAudioNodesRef.current.add(source);
    setIsModelSpeaking(true);

    source.onended = () => {
      activeAudioNodesRef.current.delete(source);
      if (activeAudioNodesRef.current.size === 0) {
        setIsModelSpeaking(false);
      }
    };

    source.start(startAt);
  }, []);

  const playWavBase64 = useCallback(
    async (base64Wav: string, activeSessionId: number) => {
      if (sessionIdRef.current !== activeSessionId) return;
      stopScheduledPlayback();

      try {
        const binary = atob(base64Wav);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'audio/wav' });
        const objectUrl = URL.createObjectURL(blob);
        fallbackAudioUrlRef.current = objectUrl;

        const audio = new Audio(objectUrl);
        fallbackAudioRef.current = audio;
        setIsModelSpeaking(true);

        audio.onended = () => {
          if (fallbackAudioRef.current === audio) {
            stopFallbackPlayback();
            setIsModelSpeaking(false);
          }
        };
        audio.onerror = () => {
          if (fallbackAudioRef.current === audio) {
            stopFallbackPlayback();
            setIsModelSpeaking(false);
          }
        };

        await audio.play();
      } catch {
        stopFallbackPlayback();
        setIsModelSpeaking(false);
      }
    },
    [stopFallbackPlayback, stopScheduledPlayback],
  );

  const appendTranscript = useCallback(
    (role: 'user' | 'assistant', chunkText: string, asSeparateTurn = false) => {
      const cleaned = chunkText;
      if (!cleaned) return;
      setTranscripts((prev) => {
        const last = prev[prev.length - 1];
        if (!asSeparateTurn && last && last.role === role) {
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              text: `${last.text}${cleaned}`,
            },
          ];
        }
        return [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role,
            text: cleaned.trimStart(),
          },
        ];
      });
    },
    [],
  );

  const sendFallbackTurn = useCallback(
    async (payload: { text?: string; audioBase64?: string; audioMimeType?: string }) => {
      const activeSessionId = sessionIdRef.current;
      const trimmedText = payload.text?.trim() || '';
      if (!trimmedText && !payload.audioBase64) return;

      stopScheduledPlayback();
      setIsFallbackSending(true);
      setErrorMsg(null);

      if (trimmedText) {
        appendTranscript('user', trimmedText, true);
      }

      try {
        const res = await fetch('/api/live/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: trimmedText || undefined,
            audioBase64: payload.audioBase64,
            audioMimeType: payload.audioMimeType,
            history: transcriptsRef.current.slice(-8).map((item) => ({
              role: item.role,
              text: item.text,
            })),
            destination: contextDestination,
            listing: contextListing,
          }),
        });

        if (sessionIdRef.current !== activeSessionId) return;

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error(
            'Voice backend is unreachable on static-only hosting. Use the full-stack server deployment for Live Voice.',
          );
        }

        const data = (await res.json()) as {
          userText?: string;
          replyText?: string;
          audioBase64Wav?: string | null;
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || 'Voice assistant request failed.');
        }

        if (!trimmedText && data.userText) {
          appendTranscript('user', data.userText, true);
        }

        if (data.replyText) {
          appendTranscript('assistant', data.replyText, true);
        }

        if (data.audioBase64Wav) {
          await playWavBase64(data.audioBase64Wav, activeSessionId);
        } else if (
          data.replyText &&
          typeof window !== 'undefined' &&
          'speechSynthesis' in window
        ) {
          try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(data.replyText);
            utterance.rate = 1.02;
            utterance.onstart = () => setIsModelSpeaking(true);
            utterance.onend = () => setIsModelSpeaking(false);
            utterance.onerror = () => setIsModelSpeaking(false);
            window.speechSynthesis.speak(utterance);
          } catch {
            // Ignore SpeechSynthesis playback errors
          }
        }
      } catch (err) {
        if (sessionIdRef.current !== activeSessionId) return;
        setErrorMsg(err instanceof Error ? err.message : 'Unable to reach voice assistant.');
      } finally {
        if (sessionIdRef.current === activeSessionId) {
          setIsFallbackSending(false);
        }
      }
    },
    [appendTranscript, contextDestination, contextListing, playWavBase64, stopScheduledPlayback],
  );

  const checkLiveBackendAvailability = useCallback(async (): Promise<{
    reachable: boolean;
    configured: boolean;
    message?: string;
  }> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch('/api/live/status', { signal: controller.signal });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        return {
          reachable: false,
          configured: false,
          message:
            'Live Voice requires the Tourx backend server with Gemini API enabled. It is unavailable on static-only hosting.',
        };
      }
      const data = (await res.json()) as {
        liveVoiceConfigured?: boolean;
        message?: string;
      };
      return {
        reachable: true,
        configured: data.liveVoiceConfigured !== false,
        message: data.message,
      };
    } catch {
      return {
        reachable: false,
        configured: false,
        message:
          'Unable to reach the Tourx Voice backend. Check your connection and deployed server status.',
      };
    } finally {
      window.clearTimeout(timer);
    }
  }, []);

  const activateFallbackOrError = useCallback(
    async (activeSessionId: number, failureMessage: string) => {
      if (sessionIdRef.current !== activeSessionId) return;
      clearHandshakeTimer();

      if (wsRef.current) {
        const oldWs = wsRef.current;
        wsRef.current = null;
        try {
          oldWs.close();
        } catch {
          // Ignore close error
        }
      }

      const health = await checkLiveBackendAvailability();
      if (sessionIdRef.current !== activeSessionId) return;

      if (!health.reachable || !health.configured) {
        releaseMediaAndSockets();
        setStatus('error');
        setErrorMsg(
          health.message ||
            failureMessage ||
            'GEMINI_API_KEY is not configured in the deployed server environment variables.',
        );
        return;
      }

      // Live WebSocket blocked by proxy/firewall, switch automatically to HTTP Voice Mode
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
        processorRef.current = null;
      }
      if (zeroGainRef.current) {
        zeroGainRef.current.disconnect();
        zeroGainRef.current = null;
      }
      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect();
        sourceNodeRef.current = null;
      }
      if (mediaStreamRef.current) {
        for (const track of mediaStreamRef.current.getTracks()) {
          track.stop();
        }
        mediaStreamRef.current = null;
      }

      isLiveReadyRef.current = true;
      setConnectionMode('fallback');
      setStatus('live');
      setErrorMsg(null);

      const pendingPrompt = queuedPromptRef.current;
      queuedPromptRef.current = null;
      if (pendingPrompt) {
        void sendFallbackTurn({ text: pendingPrompt });
      }
    },
    [checkLiveBackendAvailability, clearHandshakeTimer, releaseMediaAndSockets, sendFallbackTurn],
  );

  const startLiveSession = async (initialPrompt?: string) => {
    const activeSessionId = sessionIdRef.current + 1;
    sessionIdRef.current = activeSessionId;
    intentionalCloseRef.current = false;
    queuedPromptRef.current = initialPrompt?.trim() || null;

    clearHandshakeTimer();
    stopScheduledPlayback();
    stopMicCapture();
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore close error
      }
      wsRef.current = null;
    }
    if (inputCtxRef.current) {
      void inputCtxRef.current.close().catch(() => undefined);
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      void outputCtxRef.current.close().catch(() => undefined);
      outputCtxRef.current = null;
    }

    isLiveReadyRef.current = false;
    setErrorMsg(null);
    setMicNotice(null);
    setConnectionMode('realtime');
    setStatus('connecting');

    // Synchronously create and unlock AudioContexts inside the click gesture
    let outCtx: AudioContext;
    try {
      outCtx = new AudioContext({ sampleRate: 24000 });
    } catch {
      outCtx = new AudioContext();
    }
    outputCtxRef.current = outCtx;
    nextStartTimeRef.current = outCtx.currentTime;
    void outCtx.resume().catch(() => undefined);

    let inCtx: AudioContext;
    try {
      inCtx = new AudioContext({ sampleRate: 16000 });
    } catch {
      inCtx = new AudioContext();
    }
    inputCtxRef.current = inCtx;
    void inCtx.resume().catch(() => undefined);

    // Check server configuration cleanly
    const health = await checkLiveBackendAvailability();
    if (sessionIdRef.current !== activeSessionId) return;
    if (!health.reachable || !health.configured) {
      releaseMediaAndSockets();
      setStatus('error');
      setErrorMsg(
        health.message ||
          'GEMINI_API_KEY is missing in your deployed server environment variables.',
      );
      return;
    }

    // Request microphone softly so denied/blocked mic permissions never break voice playback + text
    let acquiredStream: MediaStream | null = null;
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        acquiredStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (micErr) {
        const msg =
          micErr instanceof Error && micErr.name === 'NotFoundError'
            ? 'No microphone detected on this device. You can still type questions below and hear voice replies.'
            : 'Microphone access was blocked or unavailable in this browser/iframe. You can still type questions below and hear voice replies.';
        setMicNotice(msg);
      }
    } else {
      setMicNotice(
        'Microphone capture requires HTTPS and a supported browser. You can still type questions below and hear voice replies.',
      );
    }

    if (sessionIdRef.current !== activeSessionId) {
      if (acquiredStream) {
        for (const t of acquiredStream.getTracks()) t.stop();
      }
      return;
    }

    setMicAvailable(Boolean(acquiredStream));
    mediaStreamRef.current = acquiredStream;

    await Promise.all([safeResumeContext(outCtx), safeResumeContext(inCtx)]);
    if (sessionIdRef.current !== activeSessionId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams();
    if (contextDestination) params.set('destination', contextDestination);
    if (contextListing) params.set('listing', contextListing);
    const qs = params.toString();
    const wsUrl = `${protocol}//${window.location.host}/api/live${qs ? `?${qs}` : ''}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      await activateFallbackOrError(
        activeSessionId,
        'WebSocket connections are blocked in this environment.',
      );
      return;
    }
    wsRef.current = ws;

    handshakeTimerRef.current = window.setTimeout(() => {
      if (sessionIdRef.current !== activeSessionId || isLiveReadyRef.current) return;
      void activateFallbackOrError(
        activeSessionId,
        'Live WebSocket handshake timed out.',
      );
    }, 10000);

    ws.onmessage = (event) => {
      if (sessionIdRef.current !== activeSessionId) return;
      try {
        const msg = JSON.parse(event.data as string) as {
          type?: string;
          data?: string;
          text?: string;
          error?: string;
        };

        if (msg.type === 'connecting') {
          return;
        }
        if (msg.type === 'ping') {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
          return;
        }

        if (msg.type === 'ready') {
          clearHandshakeTimer();
          isLiveReadyRef.current = true;
          setConnectionMode('realtime');
          setStatus('live');

          const pendingPrompt = queuedPromptRef.current;
          queuedPromptRef.current = null;
          if (pendingPrompt && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'text', text: pendingPrompt }));
            appendTranscript('user', pendingPrompt, true);
          }
        } else if (msg.type === 'audio' && msg.data) {
          scheduleAudioChunk(msg.data);
        } else if (msg.type === 'inputTranscript' && msg.text) {
          appendTranscript('user', msg.text);
        } else if (msg.type === 'outputTranscript' && msg.text) {
          appendTranscript('assistant', msg.text);
        } else if (msg.type === 'interrupted') {
          stopScheduledPlayback();
        } else if (msg.type === 'error') {
          if (!isLiveReadyRef.current) {
            void activateFallbackOrError(
              activeSessionId,
              msg.error || 'Live Voice WebSocket failed to connect.',
            );
            return;
          }
          releaseMediaAndSockets();
          setErrorMsg(msg.error || 'Voice conversation encountered an error.');
          setStatus('error');
        } else if (msg.type === 'closed') {
          cleanupSession();
        }
      } catch {
        // Ignore malformed frame
      }
    };

    ws.onerror = () => {
      if (intentionalCloseRef.current || sessionIdRef.current !== activeSessionId) return;
      if (!isLiveReadyRef.current) {
        void activateFallbackOrError(
          activeSessionId,
          'Unable to connect to the Tourx Live Voice WebSocket server.',
        );
        return;
      }
      releaseMediaAndSockets();
      setStatus('error');
      setErrorMsg('Live Voice connection was interrupted. Click below to reconnect.');
    };

    ws.onclose = () => {
      if (sessionIdRef.current !== activeSessionId) return;
      const wasReady = isLiveReadyRef.current;
      const wasIntentional = intentionalCloseRef.current;
      clearHandshakeTimer();

      if (!wasIntentional && !wasReady) {
        void activateFallbackOrError(
          activeSessionId,
          'Voice WebSocket closed before opening.',
        );
        return;
      }
      releaseMediaAndSockets();
      setStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
    };

    if (acquiredStream) {
      try {
        const source = inCtx.createMediaStreamSource(acquiredStream);
        const processor = inCtx.createScriptProcessor(4096, 1, 1);
        const zeroGain = inCtx.createGain();
        zeroGain.gain.value = 0;

        sourceNodeRef.current = source;
        processorRef.current = processor;
        zeroGainRef.current = zeroGain;

        processor.onaudioprocess = (e) => {
          if (sessionIdRef.current !== activeSessionId) return;
          if (isMutedRef.current || !isLiveReadyRef.current) {
            setMicLevel(0);
            return;
          }
          const activeWs = wsRef.current;
          if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;

          const rawFloat32 = e.inputBuffer.getChannelData(0);
          let sumSq = 0;
          for (let i = 0; i < rawFloat32.length; i += 16) {
            sumSq += rawFloat32[i] * rawFloat32[i];
          }
          const nowMs = Date.now();
          if (nowMs - lastMicUiUpdateRef.current > 120) {
            lastMicUiUpdateRef.current = nowMs;
            const rms = Math.sqrt(sumSq / Math.max(1, rawFloat32.length / 16));
            setMicLevel(Math.min(1, rms * 6));
          }

          const pcm16k = downsampleBuffer(rawFloat32, inCtx.sampleRate, 16000);
          const base64Pcm = float32ToBase64Pcm(pcm16k);
          activeWs.send(JSON.stringify({ type: 'audio', data: base64Pcm }));
        };

        source.connect(processor);
        processor.connect(zeroGain);
        zeroGain.connect(inCtx.destination);
      } catch {
        setMicNotice(
          'Could not initialize microphone audio stream. You can still type questions below.',
        );
      }
    }
  };

  const toggleFallbackRecording = async () => {
    if (connectionMode !== 'fallback' || status !== 'live' || isFallbackSending) return;

    if (isRecordingFallback && mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        setIsRecordingFallback(false);
      }
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicNotice(
        'Microphone capture requires HTTPS and a supported browser. Type your question below instead.',
      );
      setMicAvailable(false);
      return;
    }

    stopScheduledPlayback();
    setErrorMsg(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;
      setMicAvailable(true);
      setMicNotice(null);

      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const mimeType =
        preferredTypes.find((type) =>
          typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
        ) || '';

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recordedChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        setIsRecordingFallback(false);
        for (const t of stream.getTracks()) t.stop();
        if (mediaStreamRef.current === stream) {
          mediaStreamRef.current = null;
        }
        const blob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || mimeType || 'audio/webm',
        });
        recordedChunksRef.current = [];
        if (blob.size < 400) return;
        try {
          const audioBase64 = await blobToBase64(blob);
          await sendFallbackTurn({
            audioBase64,
            audioMimeType: blob.type || 'audio/webm',
          });
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to process voice recording.');
        }
      };

      recorder.start();
      setIsRecordingFallback(true);
    } catch {
      setMicAvailable(false);
      setMicNotice(
        'Microphone access was denied. You can still type questions below and hear voice replies.',
      );
    }
  };

  const sendTextPrompt = (textToSend: string) => {
    const cleaned = textToSend.trim();
    if (!cleaned) return;

    if (outputCtxRef.current && outputCtxRef.current.state === 'suspended') {
      void outputCtxRef.current.resume().catch(() => undefined);
    }

    if (status === 'idle' || status === 'error') {
      setTextInput('');
      void startLiveSession(cleaned);
      return;
    }

    if (status === 'connecting') {
      queuedPromptRef.current = cleaned;
      setTextInput('');
      return;
    }

    if (connectionMode === 'fallback') {
      setTextInput('');
      void sendFallbackTurn({ text: cleaned });
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !isLiveReadyRef.current) {
      queuedPromptRef.current = cleaned;
      void activateFallbackOrError(sessionIdRef.current, 'Live socket disconnected.');
      setTextInput('');
      return;
    }

    wsRef.current.send(JSON.stringify({ type: 'text', text: cleaned }));
    appendTranscript('user', cleaned, true);
    setTextInput('');
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-voice-title"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col max-h-[88vh]">
        <div className="px-6 py-4 bg-[#07141A] text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AudioLines className="w-5 h-5 text-teal-400" />
            <div>
              <h2 id="live-voice-title" className="text-sm font-bold">
                Tourx Live Voice Concierge
              </h2>
              <p className="text-[11px] text-slate-300">
                {connectionMode === 'fallback' && status === 'live'
                  ? 'Standard Voice Mode (HTTPS)'
                  : 'Real-time two-way voice conversation'}
                {contextDestination ? ` · ${contextDestination}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              cleanupSession();
              onClose();
            }}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10"
            aria-label="Close voice concierge"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 bg-slate-50 border-b border-slate-200 flex flex-col items-center text-center space-y-4">
          <div
            className={`w-20 h-20 rounded-full flex items-center justify-center border-2 transition-all ${
              status === 'live'
                ? isModelSpeaking
                  ? 'bg-teal-600 border-teal-300 text-white scale-105 shadow-lg shadow-teal-600/30'
                  : isRecordingFallback
                    ? 'bg-red-600 border-red-300 text-white scale-105 animate-pulse'
                    : isMuted || !micAvailable
                      ? 'bg-slate-200 border-slate-300 text-slate-600'
                      : 'bg-slate-900 border-teal-400 text-teal-400'
                : status === 'connecting' || isFallbackSending
                  ? 'bg-slate-800 border-slate-600 text-teal-300'
                  : 'bg-white border-slate-200 text-slate-700'
            }`}
            style={
              status === 'live' &&
              connectionMode === 'realtime' &&
              micAvailable &&
              !isMuted &&
              !isModelSpeaking &&
              micLevel > 0.04
                ? { boxShadow: `0 0 0 ${Math.round(micLevel * 12)}px rgba(20, 184, 166, 0.25)` }
                : undefined
            }
          >
            {status === 'connecting' || isFallbackSending ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : isModelSpeaking ? (
              <Volume2 className="w-8 h-8" />
            ) : !micAvailable ? (
              <MicOff className="w-8 h-8" />
            ) : (
              <Mic className="w-8 h-8" />
            )}
          </div>

          <div>
            <p className="text-sm font-bold text-slate-900">
              {status === 'idle' && 'Ready to Talk'}
              {status === 'connecting' && 'Connecting Live Audio...'}
              {status === 'live' &&
                (isFallbackSending
                  ? 'Thinking & Preparing Spoken Reply...'
                  : isModelSpeaking
                    ? connectionMode === 'realtime'
                      ? 'Concierge Speaking (Interrupt anytime)'
                      : 'Concierge Speaking'
                    : isRecordingFallback
                      ? 'Recording — Tap "Send Voice" When Done'
                      : !micAvailable
                        ? 'Voice Ready (Type Below for Spoken Replies)'
                        : connectionMode === 'fallback'
                          ? 'Voice Ready — Tap to Speak or Type Below'
                          : isMuted
                            ? 'Microphone Muted'
                            : 'Listening Live — Speak Naturally')}
              {status === 'error' && 'Connection Issue'}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Ask about homestays, local guides, trip planning, or PhonePe &amp; Google Pay bookings.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {status === 'live' || status === 'connecting' ? (
              <>
                {connectionMode === 'realtime' && micAvailable && (
                  <button
                    type="button"
                    onClick={() => setIsMuted((m) => !m)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      isMuted
                        ? 'bg-amber-50 border-amber-300 text-amber-900'
                        : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-100'
                    }`}
                  >
                    {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    {isMuted ? 'Unmute Mic' : 'Mute Mic'}
                  </button>
                )}

                {connectionMode === 'fallback' && status === 'live' && (
                  <button
                    type="button"
                    disabled={isFallbackSending}
                    onClick={() => void toggleFallbackRecording()}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60 ${
                      isRecordingFallback
                        ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                        : 'bg-teal-600 text-white hover:bg-teal-700'
                    }`}
                  >
                    {isRecordingFallback ? (
                      <>
                        <Square className="w-3.5 h-3.5 fill-current" />
                        Send Voice
                      </>
                    ) : (
                      <>
                        <Mic className="w-4 h-4" />
                        Tap to Speak
                      </>
                    )}
                  </button>
                )}

                {isModelSpeaking && (
                  <button
                    type="button"
                    onClick={stopScheduledPlayback}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-100"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Stop Audio
                  </button>
                )}

                <button
                  type="button"
                  onClick={cleanupSession}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors"
                >
                  <PhoneOff className="w-4 h-4" />
                  End Call
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void startLiveSession()}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors"
              >
                {status === 'error' ? (
                  <RefreshCw className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
                {status === 'error'
                  ? 'Retry Live Voice Connection'
                  : 'Start Live Voice Conversation'}
              </button>
            )}
          </div>

          {micNotice && (
            <div className="w-full p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 text-left">
              {micNotice}
            </div>
          )}

          {errorMsg && (
            <div className="w-full p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 text-left">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto tourx-scroll p-4 space-y-3 min-h-[180px] bg-white">
          {transcripts.length === 0 ? (
            <div className="space-y-2 py-2">
              <p className="text-xs font-semibold text-slate-500 text-center">
                Tap a question to start talking right away:
              </p>
              <div className="flex flex-col gap-1.5">
                {[
                  'How do I book a homestay and pay with PhonePe or Google Pay?',
                  'What should I consider when exploring local guides on the World Map?',
                  'How can a host upload a listing and set their UPI number in Host Studio?',
                ].map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    disabled={isFallbackSending}
                    onClick={() => sendTextPrompt(starter)}
                    className="text-left px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    &ldquo;{starter}&rdquo;
                  </button>
                ))}
              </div>
            </div>
          ) : (
            transcripts.map((entry) => (
              <div
                key={entry.id}
                className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3.5 py-2 text-xs leading-relaxed ${
                    entry.role === 'user'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-800 border border-slate-200'
                  }`}
                >
                  {entry.text}
                </div>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendTextPrompt(textInput);
          }}
          className="p-3 border-t border-slate-200 bg-slate-50 flex gap-2"
        >
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={
              status === 'live'
                ? 'Type a question or follow-up for a spoken reply...'
                : 'Type a question to start a voice session...'
            }
            className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
          <button
            type="submit"
            disabled={isFallbackSending || !textInput.trim()}
            className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1"
            aria-label="Send message to voice concierge"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
