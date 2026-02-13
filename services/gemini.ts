
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export class GeminiService {
  private userProfile: string = "The owner is a visually impaired individual. They speak directly to the assistant. Background noise, other people talking to each other, or TV sounds should be ignored.";

  async analyzeScene(imageData: string, prompt: string, isProactive: boolean = false): Promise<string> {
    const systemInstruction = isProactive 
      ? `You are SafeStep PROACTIVE EYES. 
         OBJECTIVE: Spot hazards immediately.
         RULES:
         1. If the path is safe, respond ONLY with 'PATH_CLEAR'.
         2. If there is a hazard (step, hole, vehicle, obstacle), state it briefly: 'Alert: [hazard] at [distance]'.
         3. Be extremely concise. Use meters.
         4. Priority: Immediate safety > Navigation.`
      : `You are SafeStep, the dedicated visual assistant for your owner. 
         Describe the scene with high precision. Always prioritize distances and safety hazards.`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { inlineData: { data: imageData.split(',')[1], mimeType: 'image/jpeg' } },
            { text: prompt }
          ]
        },
        config: {
          temperature: 0.1,
          systemInstruction: systemInstruction
        }
      });

      return response.text || "No response.";
    } catch (error) {
      console.error("Gemini Scene Analysis Error:", error);
      return "ERROR";
    }
  }

  async navigate(query: string, latLng: { latitude: number, longitude: number }): Promise<{ text: string, links: any[] }> {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite-latest",
        contents: query,
        config: {
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: latLng
            }
          }
        },
      });

      const text = response.text || "I couldn't find navigation info.";
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const links = chunks.filter((c: any) => c.maps).map((c: any) => ({
        title: c.maps.title,
        uri: c.maps.uri
      }));

      return { text, links };
    } catch (error) {
      console.error("Navigation Error:", error);
      return { text: "Navigation service is currently unavailable.", links: [] };
    }
  }

  async verifyAndProcessCommand(command: string, currentContext: string): Promise<{ authorized: boolean; response: string }> {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Command: "${command}"\nContext: ${currentContext}`,
        config: {
          systemInstruction: `You are the Security Filter for SafeStep. 
          Owner Profile: ${this.userProfile}.
          TASK: Is this command meant for you?
          If the user asks 'how it works', 'help', or 'what can you do', explain that you provide real-time hazard detection, object identification, navigation, and text reading.
          If it's background noise or someone else talking, set authorized: false.
          If it's the owner giving a command (e.g., 'detect', 'read', 'stop', 'help', 'navigate to...', 'find nearest...'), set authorized: true.
          Return ONLY valid JSON: { "authorized": boolean, "response": "brief conversational response if authorized" }`,
          responseMimeType: "application/json"
        }
      });

      const cleanText = response.text.replace(/```json|```/g, "").trim();
      return JSON.parse(cleanText);
    } catch (error) {
      console.error("Identity Filter Error:", error);
      return { authorized: true, response: "Processing command." };
    }
  }
}

export const geminiService = new GeminiService();
