import type { Schema } from '../../src/types.js';
export const addressBook = { me: 0x00401000, session: 0x00402000, guard: 0x00403000, 'me.circle': 0x00404100, 'me.sine': 0x00404200, 'me.eggplant': 0x00404300, 'me.tomato': 0x00404400, 'me.cat': 0x00404500 };
export const schemas: Schema[] = [
  { name: 'Actor', alignment: 16, fields: [
    { name: 'power', type: 'bool' }, { name: 'initialized', type: 'bool' },
    { name: 'status', type: { enum: ['CREATED', 'RUNNABLE', 'TERMINATED'] } },
    { name: 'goal', type: { stringRef: 'utf8' } },
    { name: 'revision', type: 'u32' }, { name: 'verified_revision', type: 'u32' },
    { name: 'form', type: { enum: ['WORLD', 'POINTS', 'CIRCLE', 'SINE', 'EGGPLANT', 'TOMATO', 'CAT', 'NONE'] } },
    { name: 'gender', type: { enum: ['UNSET', 'F', 'M'] } },
    { name: 'role', type: { enum: ['UNSET', 'S', 'M'] } },
    { name: 'period', type: { enum: ['AM', 'PM', 'UNSET'] } }, { name: 'vision', type: { enum: ['NORMAL', 'DEGRADED'] } },
    { name: 'selfData', type: { enum: ['PRESENT', 'ERASED'] } },
    { name: 'dimension', type: 'u32' }, { name: 'radius', type: 'f64' },
    { name: 'theta', type: 'f64' }, { name: 'arcLength', type: 'f64' }, { name: 'slope', type: 'f64' },
    { name: 'currentMode', type: { enum: ['SINE', 'LIMITED', 'RECTIFIED_PULSE', 'DC_SETTLED'] } },
    { name: 'targetYear', type: 'i32' }, { name: 'currentYear', type: 'i32' },
    { name: 'phaseError', type: 'f64' }, { name: 'frequency', type: 'f64' }, { name: 'purr', type: 'f64' },
    { name: 'nutrients', type: 'f64' }, { name: 'antioxidants', type: 'f64' }, { name: 'boundary', type: { ref: 'Boundary' } },
    { name: 'progress', type: 'f64' }, { name: 'lock', type: 'bool' }, { name: 'missingArc', type: 'f64' },
    { name: 'fragments', type: { bytes: 64 } },
  ] },
  { name: 'Session', alignment: 16, fields: [
    { name: 'open', type: 'bool' }, { name: 'requestSeq', type: 'u32' }, { name: 'ackSeq', type: 'u32' },
    { name: 'lastInputAtMs', type: 'i32' }, { name: 'lastAckAtMs', type: 'i32' },
    { name: 'closeAtMs', type: 'i32' },
  ] },
  { name: 'Guard', alignment: 16, fields: [{ name: 'armed', type: 'bool' }, { name: 'blocked', type: 'bool' }, { name: 'commit', type: 'u32' }] },
  { name: 'Boundary', alignment: 16, fields: [{ name: 'maximum', type: 'f64' }, { name: 'source', type: { ref: 'Session' } }] },
  { name: 'FormSnapshot', alignment: 16, fields: [
    { name: 'owner', type: { ref: 'Actor' } }, { name: 'form', type: { stringRef: 'utf8' } },
    { name: 'radius', type: 'f64' }, { name: 'strength', type: 'f64' }, { name: 'fragments', type: { bytes: 16 } },
  ] },
];
