export interface CharacterTone {
  roastLevel: number;
  warmthLevel: number;
  bluntnessLevel: number;
  chaosLevel: number;
}

export interface CharacterParsedSummary {
  name: string;
  ownerName: string;
  language: string;
  tone: CharacterTone;
}

export interface CharacterFileSummary {
  exists: boolean;
  path: string;
  text?: string;
  parsed?: CharacterParsedSummary;
  error?: string;
}

export interface PromptFileSummary {
  exists: boolean;
  path: string;
  text?: string;
  empty?: boolean;
  error?: string;
}

export interface CharacterSummary {
  ok: boolean;
  character: CharacterFileSummary;
  prompt: PromptFileSummary;
}
