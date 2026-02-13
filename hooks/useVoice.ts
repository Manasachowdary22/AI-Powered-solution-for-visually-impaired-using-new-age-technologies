
// This hook is deprecated in favor of Gemini Live API integrated directly into App.tsx
export const useVoice = (onCommand: (text: string) => void) => {
  return { isListening: false, isSupported: true, startListening: () => {}, stopListening: () => {} };
};
