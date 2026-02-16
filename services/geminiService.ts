import { GoogleGenAI, Modality, Type } from "@google/genai";
// @ts-ignore
import { Client } from "@gradio/client";
import { ProjectFile, VoiceOption, Platform, VisualAsset } from "../types";
import { decodeBase64, decodeAudioData } from "../utils/audioUtils";
import { VideoFrame } from "../utils/mediaProcessing";
import { addLog } from "../utils/logger";

const API_KEY = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey: API_KEY });

// Robust JSON cleaner
const cleanJson = (text: string): string => {
  if (!text) return "[]";
  
  // 1. Remove markdown code blocks (case insensitive)
  let clean = text.replace(/```json/gi, '').replace(/```/g, '');
  
  // 2. Find the outer-most array brackets to ignore conversational filler
  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  
  if (start !== -1 && end !== -1 && end > start) {
      clean = clean.substring(start, end + 1);
  }
  
  // 3. Remove trailing commas (common LLM error that breaks JSON.parse)
  // Replaces ",]" with "]" and ",}" with "}"
  clean = clean.replace(/,(\s*[\]}])/g, '$1');

  // 4. Trim whitespace
  return clean.trim();
};

const cleanScriptForTTS = (text: string): string => {
  let clean = text.replace(/\*+/g, '');
  clean = clean.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ');
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean;
};

// --- GEMINI: Script & Audio ---

export const generateSalesScript = async (files: ProjectFile[], platform: Platform, referenceUrl?: string): Promise<string> => {
  addLog("Generating script with Gemini...", 'info');
  const fileContext = files.map(f => `--- FILE: ${f.name} ---\n${f.content.slice(0, 10000)}`).join('\n\n');
  
  let platformInstructions = "";
  switch (platform) {
    case Platform.YOUTUBE:
      platformInstructions = "FORMAT: Educational tutorial style. Tone: Authoritative, helpful.";
      break;
    case Platform.TIKTOK:
      platformInstructions = "FORMAT: Viral TikTok style. High energy. Start with a hook. Tone: Hype, fast.";
      break;
    case Platform.INSTAGRAM:
      platformInstructions = "FORMAT: Aesthetic Instagram Reel. Tone: Trendy, polished.";
      break;
    case Platform.GENERIC:
    default:
      platformInstructions = "FORMAT: Standard ad. Tone: Professional, persuasive.";
      break;
  }

  const prompt = `
    You are a viral content creator.
    TASK: Write a 30-45 second voiceover script for ${platform}.
    
    TONE: Conversational, authentic.
    ${platformInstructions}
    
    CRITICAL: 
    1. The script must LOOP seamlessly.
    2. Output ONLY the spoken words. 
    3. Do NOT include "Speaker:" labels, scene descriptions, music cues, or stage directions in brackets.
    
    PROJECT FILES:
    ${fileContext}
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt
    });
    addLog("Script generated successfully.", 'success');
    return response.text || "Failed to generate script.";
  } catch (error: any) {
    addLog(`Script generation failed: ${error.message}`, 'error');
    console.error("Script error:", error);
    throw new Error("Failed to generate script.");
  }
};

export const generateVoiceover = async (text: string, voice: VoiceOption): Promise<{ buffer: AudioBuffer, base64: string }> => {
  addLog(`Generating voiceover (${voice})...`, 'info');
  const cleanText = cleanScriptForTTS(text);
  if (!cleanText) throw new Error("Script is empty (or contained only unreadable content).");

  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: cleanText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voice },
              },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("No audio data received from API.");

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
      const bytes = decodeBase64(base64Audio);
      const buffer = await decodeAudioData(bytes, audioContext, 24000, 1);

      addLog("Voiceover generated successfully.", 'success');
      return { buffer, base64: base64Audio };
    } catch (error: any) {
      addLog(`TTS Attempt ${attempt + 1} failed: ${error.message}`, 'warning');
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }

  addLog("TTS final failure.", 'error');
  console.error("TTS Final Failure:", lastError);
  throw new Error(`Failed to generate audio after 3 attempts. ${lastError?.message || ''}`);
};

interface VisualPlanItem {
  type: 'IMAGE' | 'VIDEO';
  description: string;
  imagePrompt?: string;
  videoStartTime?: number;
  videoEndTime?: number;
}

export const generateVisualPlan = async (
  script: string, 
  files: ProjectFile[], 
  videoFrames?: VideoFrame[]
): Promise<VisualPlanItem[]> => {
  addLog("Analyzing script for visual plan...", 'info');
  
  const fileContext = files.map(f => `${f.name}:\n${f.content.slice(0, 1000)}`).join('\n\n').slice(0, 5000);
  
  let frameContext = "";
  const frameParts: any[] = [];
  
  if (videoFrames && videoFrames.length > 0) {
    frameContext = "I have uploaded frames from a demo video of the app. Use 'VIDEO' type if a frame matches the script content.";
    const MAX_CONTEXT_FRAMES = 5;
    const step = Math.ceil(videoFrames.length / MAX_CONTEXT_FRAMES);
    
    for (let i = 0; i < videoFrames.length; i += step) {
      if (frameParts.length / 2 >= MAX_CONTEXT_FRAMES) break; 
      
      frameParts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: videoFrames[i].base64
        }
      });
      frameParts.push({
        text: `[Timestamp: ${videoFrames[i].timestamp}s]`
      });
    }
  }

  const textPrompt = `
    You are a video director. 
    Script: "${script}"
    
    Source Code Context: ${fileContext}
    
    ${frameContext}

    TASK:
    Break the script into 4-6 visual scenes. 
    For each scene, decide whether to generate a NEW AI image ('IMAGE') or use a clip from the demo video ('VIDEO').
    
    RULES:
    1. Use 'VIDEO' ONLY if the uploaded frames clearly show the feature mentioned in that part of the script.
    2. If 'VIDEO', provide the start and end timestamp based on the provided frames.
    3. If 'IMAGE', provide a highly detailed prompt for an AI image generator (modern, 3D, high-tech style).
    4. Keep descriptions and prompts concise (under 50 words).

    OUTPUT:
    Return a raw JSON Array of objects. Do not include markdown formatting.
    Schema:
    [
      {
        "type": "IMAGE" | "VIDEO",
        "description": "string",
        "imagePrompt": "string",
        "videoStartTime": number,
        "videoEndTime": number
      }
    ]
  `;

  try {
    // Switched to Pro model for better JSON adherence and reasoning
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview", 
      contents: {
        parts: [
          ...frameParts,
          { text: textPrompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING, enum: ["IMAGE", "VIDEO"] },
              description: { type: Type.STRING },
              imagePrompt: { type: Type.STRING },
              videoStartTime: { type: Type.NUMBER },
              videoEndTime: { type: Type.NUMBER }
            },
            required: ["type", "description"]
          }
        }
      }
    });

    const jsonText = cleanJson(response.text || "[]");
    
    try {
        const plan = JSON.parse(jsonText);
        addLog("Visual plan created.", 'success');
        return plan;
    } catch (parseError) {
        console.error("JSON Parse Error:", parseError);
        console.log("Raw Text:", response.text);
        console.log("Cleaned Text:", jsonText);
        throw parseError; // This will be caught below
    }

  } catch (e) {
    addLog("Visual plan generation failed, using fallback.", 'error');
    console.error("Visual plan generation failed", e);
    // Fallback plan if AI fails
    return [
      { type: 'IMAGE', description: 'Intro', imagePrompt: 'Futuristic app dashboard glowing 3d render, purple and blue neon' },
      { type: 'IMAGE', description: 'Feature Highlight', imagePrompt: 'Abstract code visualization high tech blue and purple' },
      { type: 'IMAGE', description: 'User Benefit', imagePrompt: 'Happy user holding phone modern style, photorealistic' },
      { type: 'IMAGE', description: 'Call to Action', imagePrompt: 'Sleek product logo minimalist background, cinematic lighting' }
    ];
  }
};

// --- IMAGE GENERATION STRATEGIES ---

async function generateWithFlux(prompt: string, width: number, height: number): Promise<string | null> {
    const MAX_RETRIES = 3; 
    const INITIAL_DELAY = 2000;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            if (attempt === 1) addLog(`Connecting to HF Space (Flux.1)...`, 'connect');
            else addLog(`Retrying HF Space (Attempt ${attempt}/${MAX_RETRIES})...`, 'connect');
            
            const enhancedPrompt = `${prompt}, photorealistic, 8k, highly detailed, cinematic lighting, award winning photography, sharp focus, high fidelity`;
            
            // Connect to Hugging Face
            const client = await Client.connect("black-forest-labs/FLUX.1-schnell");

            const result = await client.predict("/infer", [
                enhancedPrompt,
                0, // Seed
                true, // Randomize seed
                width, 
                height, 
                4 // Steps
            ]);

            addLog("Received response from Hugging Face.", 'info');

            const responseData = (result as any).data;
            const imageInfo = responseData?.[0];
            const imageUrl = (typeof imageInfo === 'string') ? imageInfo : imageInfo?.url;

            if (imageUrl) {
                addLog("Downloading Flux asset...", 'info');
                const res = await fetch(imageUrl);
                const blob = await res.blob();
                const base64 = await blobToBase64(blob);
                addLog("Flux Image generated.", 'success');
                return base64;
            } else {
                return null;
            }
        } catch (e: any) {
            console.warn(`Flux generation failed (Attempt ${attempt}):`, e);
            if (attempt === MAX_RETRIES) {
                addLog(`Flux failed: ${e.message}`, 'warning');
            } else {
                const delay = (Math.pow(1.5, attempt) * INITIAL_DELAY);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    return null;
}

async function generateWithGemini(prompt: string, platform: Platform): Promise<string | null> {
    try {
        addLog("Attempting fallback with Gemini Image Model...", 'info');
        
        let aspectRatio = "1:1";
        if (platform === Platform.TIKTOK || platform === Platform.INSTAGRAM) {
            aspectRatio = "9:16";
        } else if (platform === Platform.YOUTUBE || platform === Platform.GENERIC) {
            aspectRatio = "16:9";
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [{ text: prompt }]
            },
            config: {
                imageConfig: {
                    aspectRatio: aspectRatio
                }
            }
        });

        // The response might contain multiple parts, iterate to find image
        if (response.candidates?.[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData && part.inlineData.data) {
                    addLog("Gemini Image generated successfully.", 'success');
                    return part.inlineData.data;
                }
            }
        }
        
        addLog("No image data found in Gemini response.", 'warning');
        return null;

    } catch (e: any) {
        addLog(`Gemini Image Gen failed: ${e.message}`, 'error');
        return null;
    }
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const res = reader.result as string;
            resolve(res.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export const generateAsset = async (planItem: VisualPlanItem, platform: Platform): Promise<VisualAsset | null> => {
  if (planItem.type === 'VIDEO') {
    return {
      type: 'video',
      description: planItem.description,
      videoStart: planItem.videoStartTime || 0,
      videoEnd: planItem.videoEndTime || 5
    };
  }

  const isPortrait = platform === Platform.TIKTOK || platform === Platform.INSTAGRAM;
  
  // Flux Schnell supports ~1024.
  const width = isPortrait ? 768 : 1024; // 9:16 approx or 16:9 approx
  const height = isPortrait ? 1024 : 768;

  const prompt = planItem.imagePrompt || planItem.description;

  // 1. Try Flux (Hugging Face)
  const fluxBase64 = await generateWithFlux(prompt, width, height);
  if (fluxBase64) {
    return {
      type: 'image',
      base64: fluxBase64,
      prompt: prompt,
      description: planItem.description
    };
  }

  // 2. Fallback to Gemini Image Gen
  addLog("Switching to Gemini Fallback...", 'connect');
  const geminiBase64 = await generateWithGemini(prompt, platform);
  if (geminiBase64) {
    return {
      type: 'image',
      base64: geminiBase64,
      prompt: prompt,
      description: planItem.description
    };
  }

  addLog("All image generation strategies failed.", 'error');
  return null;
};
