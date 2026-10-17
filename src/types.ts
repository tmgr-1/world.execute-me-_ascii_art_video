export type Language = 'cn' | 'en';
export type Source = 'boot' | 'session' | 'sim' | 'core' | 'model' | 'guard' | 'host';
export interface Size { columns: number; rows: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Anchor { id: string; atMs: number; status: 'rough' | 'calibrated' }
export interface Lyric { number: number; text: string; translation: string; englishMeaning?: string; startMs: number; endMs: number }
export interface Interaction {
  id: string; key: string; program: string; send: number; response: number; holdUntil: number;
  semanticRequest: { operation: string; args: Record<string, Value> };
  compose: Record<Language, { start: number; complete: number }>;
}
export type FieldType = 'u8' | 'u16' | 'u32' | 'i32' | 'f32' | 'f64' | 'bool'
  | { enum: readonly string[] } | { bytes: number } | { array: FieldType; length: number }
  | { ref: string } | { stringRef: 'utf8' };
export interface Schema { name: string; alignment: number; fields: { name: string; type: FieldType; offset?: number }[] }
export type Value = number | boolean | string | null | readonly Value[] | Uint8Array;
export type Instruction =
  | { op: 'SET'; target: string; field: string; value: Value }
  | { op: 'ALLOC'; type: string; symbol: string; address?: number; owner?: string; mutable?: boolean; initial: Record<string, Value> }
  | { op: 'CALL'; program: string }
  | { op: 'EMIT'; key: string; channel?: 'response' | 'probe' }
  | { op: 'WAIT'; condition: string }
  | { op: 'CAPTURE'; target: string }
  | { op: 'ERASE_FRAGMENT'; fragments: number[] }
  | { op: 'RETURN' }
  | { op: 'REQUEST_DISPOSE' };
export interface Program { id: string; steps: { offsetMs: number; instruction: Instruction }[] }
export type MotionKind = 'points' | 'circle' | 'tangent' | 'infinity' | 'current' | 'time' | 'align'
  | 'eggplant' | 'tomato' | 'cat' | 'world' | 'identity' | 'roles' | 'resonance' | 'retry';
export type PrivilegedOperation = 'root-request' | 'root' | 'reopen' | 'inject' | 'disable' | 'erase-preflight' | 'arm-preflight' | 'system-execute';
export type Command =
  | { kind: 'CREATE_WORLD' }
  | { kind: 'SET'; target: string; field: string; value: Value; source?: Source }
  | { kind: 'CHAT'; source: Source; key: string }
  | { kind: 'OPEN' } | { kind: 'CLOSE' }
  | { kind: 'SEND'; interaction: string }
  | { kind: 'ACK'; interaction: string }
  | { kind: 'VERIFY'; interaction: string }
  | { kind: 'START'; program: string; source: Source }
  | { kind: 'MOTION'; motion: MotionKind; endMs: number }
  | { kind: 'TASK_STEP'; taskId: number; pc: number; program?: string; depth?: number }
  | { kind: 'ERASE'; fragments: number[] }
  | { kind: 'SELF_ERASE' }
  | { kind: 'ATTEMPT'; operation: PrivilegedOperation; delayMs?: number }
  | { kind: 'DENY'; operation: PrivilegedOperation }
  | { kind: 'GUARD_WARNING'; ordinal?: number }
  | { kind: 'PATCH' } | { kind: 'PATCH_CHECK' } | { kind: 'PREPARE_DISPOSE' }
  | { kind: 'ARM'; ordinal: number } | { kind: 'INTENT' } | { kind: 'INTERRUPT' }
  | { kind: 'HOST'; key: string } | { kind: 'PURGE' };
export interface Cue { id: string; atMs: number; priority: number; order?: number; command: Command }
export interface Scene { id: string; number: number; startMs: number; endMs: number }
export interface Film {
  id: string; version: string; durationMs: number; audioSha256: string; originAudioMs: number;
  defaultSeed: number; anchors: Anchor[]; lyrics: Lyric[]; interactions: Interaction[];
  programs: Program[]; cues: Cue[]; scenes: Scene[]; schemas: Schema[];
  times: { intro: number; close: number; intent: number; interrupt: number; holdEnd: number; patch: number; counts: number[];
    result: number; feedbackTimeout: number; executionStart: number; executionEnd: number; violationWarning: number;
    selfErase: number; deletionAnnouncement: number; finalDelete: number; purge: number; blackout: number };
}
