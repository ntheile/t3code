import { useCallback, useEffect, useRef } from "react";

import { ensureNativeApi } from "../nativeApi";
import type { ThreadId } from "@t3tools/contracts";

interface UseRealtimeSpeechOutputInput {
  readonly threadId: ThreadId;
  readonly enabled: boolean;
  readonly model: string | null;
  readonly voice: string | null;
  readonly instructions: string | null;
  readonly playbackRate: number;
  readonly onUtteranceStart?: () => void;
  readonly onUtteranceEnd?: () => void;
}

export function useRealtimeSpeechOutput(input: UseRealtimeSpeechOutputInput) {
  const {
    threadId,
    enabled,
    model,
    voice,
    instructions,
    playbackRate,
    onUtteranceStart,
    onUtteranceEnd,
  } = input;
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const utteranceActiveRef = useRef(false);
  const playingRef = useRef(false);
  const synthInFlightRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const idleFinishTimeoutRef = useRef<number | null>(null);
  const playbackWatchdogTimeoutRef = useRef<number | null>(null);
  const pendingQueueSkipCountRef = useRef(0);
  const currentSkipPendingRef = useRef(false);
  const enabledRef = useRef(enabled);
  const modelRef = useRef(model);
  const voiceRef = useRef(voice);
  const instructionsRef = useRef(instructions);
  const playbackRateRef = useRef(playbackRate);
  const onUtteranceStartRef = useRef(onUtteranceStart);
  const onUtteranceEndRef = useRef(onUtteranceEnd);
  const processQueueRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  useEffect(() => {
    instructionsRef.current = instructions;
  }, [instructions]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    onUtteranceStartRef.current = onUtteranceStart;
  }, [onUtteranceStart]);

  useEffect(() => {
    onUtteranceEndRef.current = onUtteranceEnd;
  }, [onUtteranceEnd]);

  const applyPlaybackRate = useCallback((audioElement: HTMLAudioElement | null) => {
    if (!audioElement) {
      return;
    }
    const nextRate = playbackRateRef.current;
    audioElement.defaultPlaybackRate = nextRate;
    audioElement.playbackRate = nextRate;
  }, []);

  const ensureAudioElement = useCallback(() => {
    if (typeof document === "undefined") {
      return null;
    }

    if (audioElementRef.current) {
      return audioElementRef.current;
    }

    const audioElement = document.createElement("audio");
    audioElement.autoplay = true;
    audioElement.muted = false;
    audioElement.className = "hidden";
    audioElement.dataset.t3VoiceOutputPlayback = "true";
    audioElement.setAttribute("playsinline", "");
    applyPlaybackRate(audioElement);
    document.body.append(audioElement);
    audioElementRef.current = audioElement;
    return audioElement;
  }, [applyPlaybackRate]);

  const releaseAudioElement = useCallback(() => {
    const audioElement = audioElementRef.current;
    if (!audioElement) {
      return;
    }
    audioElement.pause();
    audioElement.srcObject = null;
    audioElement.removeAttribute("src");
    audioElement.load();
    audioElement.remove();
    audioElementRef.current = null;
  }, []);

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const clearIdleFinishTimeout = useCallback(() => {
    if (idleFinishTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(idleFinishTimeoutRef.current);
      idleFinishTimeoutRef.current = null;
    }
  }, []);

  const clearPlaybackWatchdog = useCallback(() => {
    if (playbackWatchdogTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(playbackWatchdogTimeoutRef.current);
      playbackWatchdogTimeoutRef.current = null;
    }
  }, []);

  const finishUtterance = useCallback(() => {
    clearIdleFinishTimeout();
    clearPlaybackWatchdog();
    if (!utteranceActiveRef.current) {
      return;
    }
    utteranceActiveRef.current = false;
    onUtteranceEndRef.current?.();
  }, [clearIdleFinishTimeout, clearPlaybackWatchdog]);

  const scheduleIdleFinish = useCallback(() => {
    clearIdleFinishTimeout();
    if (typeof window === "undefined") {
      finishUtterance();
      return;
    }
    idleFinishTimeoutRef.current = window.setTimeout(() => {
      idleFinishTimeoutRef.current = null;
      if (playingRef.current || synthInFlightRef.current || queueRef.current.length > 0) {
        return;
      }
      finishUtterance();
    }, 1500);
  }, [clearIdleFinishTimeout, finishUtterance]);

  const closeSession = useCallback(() => {
    queueRef.current = [];
    playingRef.current = false;
    synthInFlightRef.current = false;
    pendingQueueSkipCountRef.current = 0;
    currentSkipPendingRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    finishUtterance();
    revokeObjectUrl();
    releaseAudioElement();
  }, [finishUtterance, releaseAudioElement, revokeObjectUrl]);

  const processQueue = useCallback(async () => {
    if (!enabledRef.current || playingRef.current || synthInFlightRef.current) {
      return;
    }
    while (pendingQueueSkipCountRef.current > 0 && queueRef.current.length > 0) {
      queueRef.current.shift();
      pendingQueueSkipCountRef.current -= 1;
    }
    const next = queueRef.current.shift();
    if (!next) {
      pendingQueueSkipCountRef.current = 0;
      currentSkipPendingRef.current = false;
      scheduleIdleFinish();
      return;
    }

    clearIdleFinishTimeout();
    if (!utteranceActiveRef.current) {
      utteranceActiveRef.current = true;
      onUtteranceStartRef.current?.();
    }

    synthInFlightRef.current = true;
    currentSkipPendingRef.current = false;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const api = ensureNativeApi();
      const result = await api.voice.synthesizeSpeech({
        threadId,
        text: next,
        model: modelRef.current,
        voice: voiceRef.current,
        instructions: instructionsRef.current,
      });
      if (controller.signal.aborted) {
        return;
      }

      const audioElement = ensureAudioElement();
      if (!audioElement) {
        throw new Error("Audio playback is unavailable in this browser.");
      }
      applyPlaybackRate(audioElement);

      const binary = atob(result.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const blob = new Blob([bytes], { type: result.mimeType });
      revokeObjectUrl();
      objectUrlRef.current = URL.createObjectURL(blob);
      audioElement.src = objectUrlRef.current;
      applyPlaybackRate(audioElement);
      playingRef.current = true;
      await audioElement.play();
    } catch {
      if (controller.signal.aborted) {
        return;
      }
      queueRef.current = [];
      pendingQueueSkipCountRef.current = 0;
      currentSkipPendingRef.current = false;
      revokeObjectUrl();
      finishUtterance();
    } finally {
      synthInFlightRef.current = false;
      abortControllerRef.current = null;
      if (controller.signal.aborted && !playingRef.current) {
        void processQueue();
      }
    }
  }, [
    applyPlaybackRate,
    clearIdleFinishTimeout,
    ensureAudioElement,
    finishUtterance,
    revokeObjectUrl,
    scheduleIdleFinish,
    threadId,
  ]);

  useEffect(() => {
    processQueueRef.current = processQueue;
  }, [processQueue]);

  const schedulePlaybackWatchdog = useCallback(
    (audioElement: HTMLAudioElement) => {
      clearPlaybackWatchdog();
      if (typeof window === "undefined") {
        return;
      }
      const duration = audioElement.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        return;
      }
      const remainingSeconds = Math.max(0, duration - audioElement.currentTime);
      const playbackRate = Math.max(0.1, audioElement.playbackRate || playbackRateRef.current || 1);
      const timeoutMs = Math.ceil((remainingSeconds / playbackRate) * 1000) + 400;
      playbackWatchdogTimeoutRef.current = window.setTimeout(() => {
        playbackWatchdogTimeoutRef.current = null;
        if (!playingRef.current) {
          return;
        }
        playingRef.current = false;
        revokeObjectUrl();
        void processQueueRef.current?.();
      }, timeoutMs);
    },
    [clearPlaybackWatchdog, revokeObjectUrl],
  );

  useEffect(() => {
    applyPlaybackRate(audioElementRef.current);
  }, [applyPlaybackRate, playbackRate]);

  const speakText = useCallback(
    async (text: string) => {
      const trimmedText = text.trim();
      if (!enabledRef.current || trimmedText.length === 0) {
        return;
      }

      clearIdleFinishTimeout();
      queueRef.current.push(trimmedText);
      await processQueue();
    },
    [clearIdleFinishTimeout, processQueue],
  );

  const advanceToNextSentence = useCallback(() => {
    const audioElement = audioElementRef.current;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    playingRef.current = false;
    clearIdleFinishTimeout();
    clearPlaybackWatchdog();
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
      audioElement.removeAttribute("src");
      audioElement.load();
    }
    revokeObjectUrl();
    void processQueue();
  }, [clearIdleFinishTimeout, clearPlaybackWatchdog, processQueue, revokeObjectUrl]);

  const skipCurrentSentence = useCallback(() => {
    const hasCurrentSentence =
      utteranceActiveRef.current && (playingRef.current || synthInFlightRef.current);
    const hasQueuedSentence = queueRef.current.length > 0;
    if (!hasCurrentSentence && !hasQueuedSentence) {
      return;
    }

    if (hasCurrentSentence) {
      if (currentSkipPendingRef.current) {
        pendingQueueSkipCountRef.current += 1;
      } else {
        currentSkipPendingRef.current = true;
      }
      advanceToNextSentence();
      return;
    }

    pendingQueueSkipCountRef.current += 1;
    void processQueue();
  }, [advanceToNextSentence, processQueue]);

  const stopSpeaking = useCallback(() => {
    queueRef.current = [];
    synthInFlightRef.current = false;
    pendingQueueSkipCountRef.current = 0;
    currentSkipPendingRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    playingRef.current = false;
    clearIdleFinishTimeout();
    clearPlaybackWatchdog();
    const audioElement = audioElementRef.current;
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
      audioElement.removeAttribute("src");
      audioElement.load();
    }
    revokeObjectUrl();
    finishUtterance();
  }, [clearIdleFinishTimeout, clearPlaybackWatchdog, finishUtterance, revokeObjectUrl]);

  useEffect(() => {
    const audioElement = ensureAudioElement();
    if (!audioElement) {
      return;
    }
    const syncPlaybackRate = () => {
      applyPlaybackRate(audioElement);
      if (playingRef.current) {
        schedulePlaybackWatchdog(audioElement);
      }
    };
    const handleEnded = () => {
      clearPlaybackWatchdog();
      playingRef.current = false;
      revokeObjectUrl();
      void processQueue();
    };
    const handleError = () => {
      clearPlaybackWatchdog();
      playingRef.current = false;
      queueRef.current = [];
      revokeObjectUrl();
      finishUtterance();
    };
    const handlePlay = () => {
      syncPlaybackRate();
      schedulePlaybackWatchdog(audioElement);
    };
    audioElement.addEventListener("loadedmetadata", syncPlaybackRate);
    audioElement.addEventListener("canplay", syncPlaybackRate);
    audioElement.addEventListener("play", handlePlay);
    audioElement.addEventListener("ended", handleEnded);
    audioElement.addEventListener("error", handleError);
    return () => {
      audioElement.removeEventListener("loadedmetadata", syncPlaybackRate);
      audioElement.removeEventListener("canplay", syncPlaybackRate);
      audioElement.removeEventListener("play", handlePlay);
      audioElement.removeEventListener("ended", handleEnded);
      audioElement.removeEventListener("error", handleError);
    };
  }, [
    applyPlaybackRate,
    clearPlaybackWatchdog,
    ensureAudioElement,
    finishUtterance,
    processQueue,
    revokeObjectUrl,
    schedulePlaybackWatchdog,
  ]);

  useEffect(() => {
    if (!enabled) {
      stopSpeaking();
      closeSession();
    }
  }, [closeSession, enabled, stopSpeaking]);

  useEffect(() => closeSession, [closeSession]);

  return {
    speakText,
    skipCurrentSentence,
    stopSpeaking,
    closeSession,
  } as const;
}
