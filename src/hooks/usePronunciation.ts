import { useCallback, useEffect, useRef, useState } from 'react';

export type PronunciationLang = 'en-US' | 'zh-CN';

/**
 * 本地发音：只使用浏览器自带的 SpeechSynthesis，不请求 MiMo TTS。
 * 语音质量取决于设备的系统语音包。
 */
export function usePronunciation() {
  const supported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window;

  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setSpeakingKey(null);
  }, [supported]);

  const speak = useCallback(
    (text: string, lang: PronunciationLang, key: string) => {
      if (!supported) {
        setError('当前浏览器不支持语音播放。');
        return;
      }
      if (!text.trim()) return;

      if (speakingKey === key) {
        stop();
        return;
      }

      utteranceRef.current = null;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = lang === 'en-US' ? 0.9 : 0.85;
      utterance.pitch = 1;

      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find((item) =>
        item.lang.toLowerCase().startsWith(lang.toLowerCase()),
      );
      if (voice) utterance.voice = voice;

      utterance.onend = () => {
        if (utteranceRef.current !== utterance) return;
        setSpeakingKey((current) => (current === key ? null : current));
      };
      utterance.onerror = () => {
        if (utteranceRef.current !== utterance) return;
        setSpeakingKey(null);
        setError('发音失败，请检查系统语音包后重试。');
      };

      utteranceRef.current = utterance;
      setError(null);
      setSpeakingKey(key);
      window.speechSynthesis.speak(utterance);
    },
    [speakingKey, stop, supported],
  );

  useEffect(() => {
    return () => {
      if (!supported) return;
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
    };
  }, [supported]);

  return { speak, stop, speakingKey, error, supported };
}
