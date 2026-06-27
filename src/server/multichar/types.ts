import type { PrismaClient } from "@prisma/client";
import type { Server as SocketIOServer } from "socket.io";

export type { PrismaClient, SocketIOServer };

export interface MulticharDeps {
  prisma: PrismaClient;
  io: SocketIOServer;
  log: (level: "info" | "warn" | "error", msg: string, data?: unknown) => void;
  loadAiSettings: () => Promise<{ value: { baseUrl: string; model: string; enabled: boolean }; encryptedApiKey: string }>;
  decryptAiApiKey: (value: string) => string;
  createMessageFromActor: (input: {
    channelId: number;
    actorId: number;
    content: string;
    type?: string;
    payload?: unknown;
    skipEngineEvent?: boolean;
    skipPush?: boolean;
  }) => Promise<{ id: number }>;
}

export interface CharacterBio {
  basics?: { name?: string; age?: number; identity?: string };
  background?: { origin?: string; education?: string; keyExperiences?: string[] };
  values?: { coreBeliefs?: string[]; dealbreakers?: string[] };
  personality?: { thinkingStyle?: string; communicationStyle?: string; emotionalPattern?: string };
  expertise?: { strengths?: string[]; knowledgeBoundaries?: string[] };
  interpersonal?: { howToJudgeOthers?: string; conflictStyle?: string; attachmentPattern?: string };
  voice?: { catchphrases?: string[]; sentencePattern?: string; taboos?: string[] };
}

export interface CharacterConfig {
  bio: CharacterBio | null;
  emotionBaseline: string;
  channels?: number[];
  manualMemory?: {
    shortTerm?: string;
    midTerm?: string;
    longTerm?: string;
  };
  thinkingEnabled?: boolean;
  modelHints?: {
    urgeModel?: string;
    mainModel?: string;
    impressionModel?: string;
  };
}

export interface StageSnapshot {
  channelId: number;
  readFromVersion: number;
  messages: SnapshotMessage[];
}

export interface SnapshotMessage {
  id: number;
  version: number;
  speakerActorId: number;
  speakerName: string;
  content: string;
  turnIndex: number;
  wallClock: Date;
  basedOnVersion: number | null;
}

export interface UrgeResult {
  wantToSpeak: boolean;
  reason: string;
  urgency: "low" | "mid" | "high";
}

export interface EngineStatus {
  characterId: number;
  characterName: string;
  running: boolean;
  channelId: number | null;
  lastUrgeAt: string | null;
  lastSpeakAt: string | null;
  turnsSinceLastSpeak: number;
  urgeEvaluations: number;
  messagesSpoken: number;
}

export interface MulticharSessionStatus {
  channelId: number;
  running: boolean;
  startedAt: string;
  characterIds: number[];
  characters: EngineStatus[];
  totalMessages: number;
}

export const MEMORY_TYPES = {
  SHORT: "mc_short",
  MID: "mc_mid",
  LONG: "mc_long",
  IMPRESSION: "mc_impression",
  EMOTION: "mc_emotion",
} as const;

export type MemoryType = typeof MEMORY_TYPES[keyof typeof MEMORY_TYPES];
