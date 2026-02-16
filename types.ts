export interface ProjectFile {
  name: string;
  content: string;
}

export enum AppState {
  IDLE = 'IDLE',
  PROCESSING_ZIP = 'PROCESSING_ZIP',
  REFERENCE_INPUT = 'REFERENCE_INPUT',
  ANALYZING = 'ANALYZING',
  SCRIPT_REVIEW = 'SCRIPT_REVIEW',
  GENERATING_AUDIO = 'GENERATING_AUDIO',
  GENERATING_VISUALS = 'GENERATING_VISUALS',
  DONE = 'DONE',
  ERROR = 'ERROR'
}

export enum VoiceOption {
  KORE = 'Kore',
  FENRIR = 'Fenrir',
  PUCK = 'Puck',
  CHARON = 'Charon',
  ZEPHYR = 'Zephyr'
}

export enum Platform {
  TIKTOK = 'TikTok',
  YOUTUBE = 'YouTube',
  INSTAGRAM = 'Instagram',
  GENERIC = 'General Ad'
}

export interface GeneratedContent {
  script: string;
  audioBuffer?: AudioBuffer;
  audioBlob?: Blob;
}

export interface VisualAsset {
  type: 'image' | 'video';
  // Common
  description: string;
  // Image specific
  base64?: string;
  prompt?: string;
  // Video specific
  videoUrl?: string; // Object URL to the source file
  videoStart?: number;
  videoEnd?: number;
}