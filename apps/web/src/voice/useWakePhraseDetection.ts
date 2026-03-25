import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_WAKE_PHRASE = "hey t3";
const WAKE_PHRASE_COOLDOWN_MS = 3000;

interface WakePhraseRecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<{
    readonly isFinal: boolean;
    readonly length: number;
    readonly item: (index: number) => {
      readonly transcript: string;
    };
    readonly [index: number]: {
      readonly transcript: string;
    };
  }>;
}

interface WakePhraseRecognitionErrorEvent {
  readonly error: string;
}

interface WakePhraseRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  addEventListener(type: "result", listener: (event: WakePhraseRecognitionEvent) => void): void;
  addEventListener(type: "error", listener: (event: WakePhraseRecognitionErrorEvent) => void): void;
  addEventListener(type: "end", listener: () => void): void;
  removeEventListener(type: "result", listener: (event: WakePhraseRecognitionEvent) => void): void;
  removeEventListener(
    type: "error",
    listener: (event: WakePhraseRecognitionErrorEvent) => void,
  ): void;
  removeEventListener(type: "end", listener: () => void): void;
}

interface WakePhraseRecognitionConstructor {
  new (): WakePhraseRecognition;
}

declare global {
  interface Window {
    webkitSpeechRecognition?: WakePhraseRecognitionConstructor;
    SpeechRecognition?: WakePhraseRecognitionConstructor;
  }
}

interface UseWakePhraseDetectionInput {
  readonly enabled: boolean;
  readonly phrase?: string;
  readonly onWakePhrase: () => void;
}

export function useWakePhraseDetection(input: UseWakePhraseDetectionInput) {
  const { enabled, phrase = DEFAULT_WAKE_PHRASE, onWakePhrase } = input;
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<WakePhraseRecognition | null>(null);
  const shouldRestartRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const onWakePhraseRef = useRef(onWakePhrase);

  useEffect(() => {
    onWakePhraseRef.current = onWakePhrase;
  }, [onWakePhrase]);

  const normalizedWakePhrase = useMemo(
    () => phrase.trim().toLowerCase().replace(/\s+/g, " "),
    [phrase],
  );

  const stopRecognition = useCallback(() => {
    shouldRestartRef.current = false;
    const recognition = recognitionRef.current;
    if (!recognition) {
      setIsListening(false);
      return;
    }
    recognition.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }, []);

  useEffect(() => {
    const RecognitionConstructor =
      typeof window === "undefined"
        ? null
        : (window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null);
    setIsSupported(Boolean(RecognitionConstructor));
    if (!enabled || !RecognitionConstructor || normalizedWakePhrase.length === 0) {
      stopRecognition();
      return;
    }

    let cancelled = false;
    const recognition = new RecognitionConstructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;
    shouldRestartRef.current = true;

    const startRecognition = () => {
      if (cancelled) {
        return;
      }
      try {
        recognition.start();
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    };

    const handleResult = (event: WakePhraseRecognitionEvent) => {
      const transcripts: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) {
          continue;
        }
        for (let alternativeIndex = 0; alternativeIndex < result.length; alternativeIndex += 1) {
          const alternative = result[alternativeIndex];
          if (alternative?.transcript) {
            transcripts.push(alternative.transcript);
          }
        }
      }
      const normalizedTranscript = transcripts.join(" ").trim().toLowerCase().replace(/\s+/g, " ");
      if (!normalizedTranscript.includes(normalizedWakePhrase)) {
        return;
      }
      const now = Date.now();
      if (now < cooldownUntilRef.current) {
        return;
      }
      cooldownUntilRef.current = now + WAKE_PHRASE_COOLDOWN_MS;
      onWakePhraseRef.current();
    };

    const handleError = () => {
      setIsListening(false);
    };

    const handleEnd = () => {
      setIsListening(false);
      if (!shouldRestartRef.current || cancelled) {
        return;
      }
      startRecognition();
    };

    recognition.addEventListener("result", handleResult);
    recognition.addEventListener("error", handleError);
    recognition.addEventListener("end", handleEnd);

    startRecognition();

    return () => {
      cancelled = true;
      recognition.removeEventListener("result", handleResult);
      recognition.removeEventListener("error", handleError);
      recognition.removeEventListener("end", handleEnd);
      stopRecognition();
    };
  }, [enabled, normalizedWakePhrase, stopRecognition]);

  return {
    isSupported,
    isListening,
    wakePhrase: normalizedWakePhrase || DEFAULT_WAKE_PHRASE,
  } as const;
}
