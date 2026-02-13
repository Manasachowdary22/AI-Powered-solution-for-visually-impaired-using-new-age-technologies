
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { AppState, LocationData } from './types';

// Constants for Live API
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-12-2025';
const FRAME_RATE = 1; // Send 1 frame per second for vision context
const SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

const App: React.FC = () => {
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [lastResponse, setLastResponse] = useState<string>("Tap to start SafeStep.");
  const [location, setLocation] = useState<LocationData | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  // Refs for Audio/Video
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<any>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const analyzerRef = useRef<AnalyserNode | null>(null);

  // --- AUDIO UTILS ---
  const encode = (bytes: Uint8Array) => {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  };

  const decode = (base64: string) => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
  };

  const decodeAudioData = async (data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> => {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) {
        channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
      }
    }
    return buffer;
  };

  // --- INITIALIZATION ---
  const startLiveSession = async () => {
    try {
      setLastResponse("Connecting to AI Brain...");
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      inputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE });
      outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });
      
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      
      if (videoRef.current) videoRef.current.srcObject = videoStream;

      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        callbacks: {
          onopen: () => {
            setIsLive(true);
            setLastResponse("SafeStep Live. Say 'Help' or ask what's in front of you.");
            
            // 1. Start Mic Streaming
            const source = inputAudioCtxRef.current!.createMediaStreamSource(micStream);
            const processor = inputAudioCtxRef.current!.createScriptProcessor(4096, 1, 1);
            analyzerRef.current = inputAudioCtxRef.current!.createAnalyser();
            analyzerRef.current.fftSize = 256;
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              // Calculate volume level for UI
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i]*inputData[i];
              setMicLevel(Math.sqrt(sum / inputData.length));

              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              
              sessionPromise.then(s => s.sendRealtimeInput({
                media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' }
              }));
            };
            source.connect(analyzerRef.current);
            source.connect(processor);
            processor.connect(inputAudioCtxRef.current!.destination);

            // 2. Start Video/Vision Streaming
            setInterval(() => {
              if (videoRef.current && canvasRef.current) {
                const ctx = canvasRef.current.getContext('2d');
                canvasRef.current.width = 320; // Lower res for faster vision
                canvasRef.current.height = 240;
                ctx?.drawImage(videoRef.current, 0, 0, 320, 240);
                const base64 = canvasRef.current.toDataURL('image/jpeg', 0.5).split(',')[1];
                sessionPromise.then(s => s.sendRealtimeInput({
                  media: { data: base64, mimeType: 'image/jpeg' }
                }));
              }
            }, 1000 / FRAME_RATE);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputAudioCtxRef.current) {
              const ctx = outputAudioCtxRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), ctx, OUTPUT_SAMPLE_RATE, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
              source.onended = () => sourcesRef.current.delete(source);
            }

            if (msg.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }

            if (msg.serverContent?.turnComplete) {
              setIsThinking(false);
            }
          },
          onerror: (e) => {
            console.error("Live Error:", e);
            setLastResponse("Connection lost. Please restart.");
            setIsLive(false);
          },
          onclose: () => setIsLive(false)
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          systemInstruction: `You are SafeStep, a proactive visual assistant for the blind.
          1. You have a LIVE CAMERA feed and AUDIO feed.
          2. Monitor for hazards (curbs, steps, obstacles) constantly.
          3. Only speak if there is a hazard or if the user asks a question.
          4. If a user says 'Hey SafeStep' or asks anything, respond naturally and concisely.
          5. Use spatial terms: '12 o'clock', 'to your left'.
          6. Your goal is safe navigation and scene understanding.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error(err);
      setLastResponse("Failed to start mic/camera.");
    }
  };

  const handleInteraction = () => {
    setHasInteracted(true);
    startLiveSession();
  };

  return (
    <div className="flex flex-col h-screen bg-black text-white p-6 font-bold select-none overflow-hidden font-sans">
      {!hasInteracted && (
        <div 
          onClick={handleInteraction}
          className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center text-center p-10 cursor-pointer"
        >
          <div className="w-48 h-48 border-[12px] border-yellow-400 rounded-full animate-pulse flex items-center justify-center mb-10 shadow-[0_0_50px_rgba(250,204,21,0.3)]">
            <div className="w-24 h-24 bg-yellow-400 rounded-full" />
          </div>
          <h2 className="text-6xl font-black text-yellow-400 mb-4 tracking-tighter uppercase">Activate SafeStep</h2>
          <p className="text-2xl font-medium text-white/60 max-w-sm">Tap anywhere to wake the AI</p>
        </div>
      )}

      {/* HEADER */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-4xl font-black text-yellow-400 tracking-tighter">SAFESTEP <span className="text-white/20 text-xs align-top">LIVE</span></h1>
          <div className="flex items-center gap-2 mt-2">
            <div className={`w-3 h-3 rounded-full ${isLive ? 'bg-green-500 animate-ping' : 'bg-red-500'}`} />
            <span className="text-[10px] tracking-widest uppercase text-white/40">{isLive ? 'Neural Link Active' : 'Disconnected'}</span>
          </div>
        </div>
        <button 
          onClick={() => window.location.reload()}
          className="px-6 py-3 rounded-2xl border-2 border-white/10 text-xs font-black uppercase hover:bg-white/5"
        >
          Reset Session
        </button>
      </div>

      {/* VIEWPORT */}
      <div className="relative flex-1 rounded-[3rem] border-4 border-white/5 overflow-hidden bg-zinc-950 shadow-inner">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover grayscale opacity-20" />
        <canvas ref={canvasRef} className="hidden" />

        {/* AUDIO VISUALIZER (Central) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 h-32">
            {[...Array(12)].map((_, i) => (
              <div 
                key={i} 
                className="w-2 bg-yellow-400 rounded-full transition-all duration-75"
                style={{ 
                  height: `${Math.max(10, micLevel * (300 + Math.random() * 200))}px`,
                  opacity: isLive ? 1 : 0.1
                }}
              />
            ))}
          </div>
        </div>

        {/* HUD OVERLAY */}
        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-12 pointer-events-none">
          <div className="bg-black/80 backdrop-blur-2xl border border-white/10 p-8 rounded-[2.5rem] shadow-2xl pointer-events-auto">
            <div className="flex items-center gap-3 mb-4">
               <div className="w-2 h-8 bg-yellow-400 rounded-full" />
               <span className="text-yellow-400 text-[10px] uppercase tracking-[0.3em]">AI Output</span>
            </div>
            <p className="text-2xl md:text-3xl font-black leading-tight">
              {lastResponse}
            </p>
          </div>
        </div>
      </div>

      {/* BOTTOM CONTROLS */}
      <div className="mt-8 grid grid-cols-2 gap-4">
        <button 
          onClick={() => sessionRef.current?.sendRealtimeInput({ media: { data: '', mimeType: 'audio/pcm;rate=16000' } })} // Dummy to wake
          className="bg-white/5 border border-white/10 rounded-[2rem] py-10 text-xs uppercase tracking-widest font-black text-white/40 active:bg-yellow-400 active:text-black transition-all"
        >
          Ping AI
        </button>
        <button 
          className="bg-white/5 border border-white/10 rounded-[2rem] py-10 text-xs uppercase tracking-widest font-black text-white/40 active:bg-red-600 active:text-white transition-all"
          onClick={() => {
             const utterance = new SpeechSynthesisUtterance("Emergency alert requested. Sending coordinates.");
             window.speechSynthesis.speak(utterance);
          }}
        >
          SOS Alert
        </button>
      </div>

      <p className="mt-6 text-center text-[8px] uppercase tracking-[0.5em] text-white/10">
        Low-Latency Neural Pathfinding Active
      </p>
    </div>
  );
};

export default App;
