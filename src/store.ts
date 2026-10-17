import type { FieldType, Schema, Source, Value } from './types.js';

interface Field { name: string; type: FieldType; offset: number; size: number }
interface Layout { name: string; alignment: number; size: number; fields: Field[] }
export interface Allocation { id: string; type: string; address: number; size: number; owner: string; mutable: boolean; missing: { offset: number; length: number }[] }
export interface Change { objectId: string; field: string; atMs: number; address: number; size: number; before: Value; after: Value; beforeBytes?: number[]; afterBytes?: number[]; erased?: boolean }
export interface StoreSnapshot { bytes: Uint8Array; allocations: Allocation[]; strings: [number, number][]; cursor: number; changes: [string, Change][] }
const align = (n: number, a: number): number => Math.ceil(n / a) * a;
export function typeSize(type: FieldType): number {
  if (typeof type === 'string') return ({ u8: 1, u16: 2, u32: 4, i32: 4, f32: 4, f64: 8, bool: 1 })[type];
  if ('bytes' in type) return type.bytes;
  if ('array' in type) return typeSize(type.array) * type.length;
  return 4;
}
const naturalAlignment = (type: FieldType): number => typeof type !== 'string' && 'array' in type ? naturalAlignment(type.array) : Math.min(8, typeof type !== 'string' && 'bytes' in type ? 1 : typeSize(type));

export class ObjectStore {
  readonly base = 0x00400000;
  readonly bytes = Buffer.alloc(0x20000);
  readonly layouts = new Map<string, Layout>();
  readonly allocations = new Map<string, Allocation>();
  readonly changes = new Map<string, Change>();
  private strings = new Map<number, number>();
  private cursor = 0x00408000;
  constructor(schemas: Schema[], private readonly authorize: (target: string, source: Source) => void = () => {}) {
    for (const schema of schemas) {
      if (this.layouts.has(schema.name) || schema.alignment < 1 || (schema.alignment & (schema.alignment - 1))) throw new Error(`E_SCHEMA:${schema.name}`);
      let end = 0; const fields: Field[] = [];
      for (const definition of schema.fields) {
        const size = typeSize(definition.type), a = naturalAlignment(definition.type);
        const offset = definition.offset ?? align(end, a);
        if (!Number.isInteger(offset) || offset < 0 || offset % a || size < 1 || fields.some(f => f.name === definition.name || offset < f.offset + f.size && offset + size > f.offset)) throw new Error(`E_FIELD_LAYOUT:${schema.name}.${definition.name}`);
        fields.push({ ...definition, offset, size }); end = Math.max(end, offset + size);
      }
      this.layouts.set(schema.name, { ...schema, fields, size: align(end, schema.alignment) });
    }
  }
  private checkRange(address: number, size: number): void {
    if (address < this.base || address + size > this.base + this.bytes.length) throw new Error('E_MEMORY_CAPACITY');
    if ([...this.allocations.values()].some(a => address < a.address + a.size && address + size > a.address) || [...this.strings].some(([at, n]) => address < at + n && address + size > at)) throw new Error('E_MEMORY_OVERLAP');
  }
  create(type: string, id: string, initial: Record<string, Value>, atMs: number, address?: number, owner = 'me', mutable = true, source: Source = 'boot'): Allocation {
    if (this.allocations.has(id)) throw new Error(`E_DUPLICATE_OBJECT:${id}`);
    this.authorize(id, source);
    const layout = this.layouts.get(type); if (!layout) throw new Error(`E_SCHEMA_MISSING:${type}`);
    const at = address ?? align(this.cursor, layout.alignment);
    if (at % layout.alignment) throw new Error('E_MEMORY_ALIGNMENT'); this.checkRange(at, layout.size);
    const allocation: Allocation = { id, type, address: at, size: layout.size, owner, mutable: true, missing: [] };
    this.allocations.set(id, allocation);
    if (address === undefined) this.cursor = at + layout.size;
    for (const field of layout.fields) this.writeValue(field.type, at - this.base + field.offset, initial[field.name] ?? this.defaultValue(field.type));
    allocation.mutable = mutable;
    this.changes.set(`${id}:ALLOC`, { objectId: id, field: 'ALLOC', atMs, address: at, size: layout.size, before: null, after: id });
    return allocation;
  }
  private defaultValue(type: FieldType): Value {
    if (type === 'bool') return false;
    if (typeof type !== 'string') {
      if ('enum' in type) return type.enum[0];
      if ('ref' in type) return null;
      if ('stringRef' in type) return '';
      if ('bytes' in type) return new Uint8Array(type.bytes);
      if ('array' in type) return Array.from({ length: type.length }, () => this.defaultValue(type.array));
    }
    return 0;
  }
  allocation(id: string): Allocation { const a = this.allocations.get(id); if (!a) throw new Error(`E_REFERENCE:${id}`); return a; }
  field(id: string, name: string): Field {
    const a = this.allocation(id), field = this.layouts.get(a.type)!.fields.find(f => f.name === name);
    if (!field) throw new Error(`E_FIELD:${id}.${name}`); return field;
  }
  read(id: string, name: string): Value { const a = this.allocation(id), f = this.field(id, name); return this.readValue(f.type, a.address - this.base + f.offset); }
  valid(id: string, name: string): boolean { const a = this.allocation(id), f = this.field(id, name); return !a.missing.some(r => r.offset < f.offset + f.size && r.offset + r.length > f.offset); }
  set(id: string, name: string, value: Value, source: Source, atMs: number): Change | null {
    this.authorize(id, source);
    const a = this.allocation(id); if (!a.mutable) throw new Error(`E_READ_ONLY:${id}`);
    const f = this.field(id, name), before = this.read(id, name);
    if (JSON.stringify(before) === JSON.stringify(value) && this.valid(id, name)) return null;
    // Encode into a scratch copy first: an invalid enum/value never partially commits.
    const fieldOffset = a.address - this.base + f.offset;
    const backup = Buffer.from(this.bytes.subarray(fieldOffset, fieldOffset + f.size));
    const strings = new Map(this.strings); const cursor = this.cursor;
    try { this.writeValue(f.type, a.address - this.base + f.offset, value); }
    catch (error) { backup.copy(this.bytes, fieldOffset); this.bytes.fill(0, cursor - this.base, this.cursor - this.base); this.strings = strings; this.cursor = cursor; throw error; }
    a.missing = a.missing.flatMap(r => {
      const end = r.offset + r.length, fe = f.offset + f.size;
      if (end <= f.offset || r.offset >= fe) return [r];
      return [...(r.offset < f.offset ? [{ offset: r.offset, length: f.offset - r.offset }] : []), ...(end > fe ? [{ offset: fe, length: end - fe }] : [])];
    });
    const change = { objectId: id, field: name, atMs, address: a.address + f.offset, size: f.size, before, after: this.read(id, name),
      beforeBytes: [...backup], afterBytes: [...this.bytes.subarray(fieldOffset, fieldOffset + f.size)] };
    this.changes.set(`${id}:${name}`, change); return change;
  }
  erase(id: string, offset: number, length: number, source: Source, atMs: number): void {
    this.authorize(id, source); const a = this.allocation(id);
    if (!a.mutable || offset < 0 || length < 1 || offset + length > a.size) throw new Error('E_ERASE_RANGE');
    // The film permits erasing only fragment bytes, never adjacent goal/status fields.
    const fragments = this.field(id, 'fragments');
    if (offset < fragments.offset || offset + length > fragments.offset + fragments.size) throw new Error('E_PERMISSION:ERASE_FRAGMENT');
    this.bytes.fill(0, a.address - this.base + offset, a.address - this.base + offset + length);
    a.missing.push({ offset, length });
    this.changes.set(`${id}:erase:${offset}`, { objectId: id, field: 'fragments', atMs, address: a.address + offset, size: length, before: null, after: 0, erased: true });
  }
  eraseOwnedForm(id: string, owner: string, source: Source, atMs: number): void {
    this.authorize(id, source);
    const a = this.allocation(id);
    if (a.type !== 'FormSnapshot' || a.owner !== owner) throw new Error('E_PERMISSION:SELF_ERASE');
    // Destruction of an owned snapshot does not grant write access to external objects.
    for (const f of this.layouts.get(a.type)!.fields) if (typeof f.type === 'object' && 'stringRef' in f.type) {
      const ref = this.bytes.readUInt32LE(a.address - this.base + f.offset), length = this.strings.get(ref);
      if (length !== undefined) { this.bytes.fill(0, ref - this.base, ref - this.base + length); this.strings.delete(ref); }
    }
    this.bytes.fill(0, a.address - this.base, a.address - this.base + a.size);
    a.missing = [{ offset: 0, length: a.size }];
    this.changes.set(`${id}:SELF_ERASE`, { objectId: id, field: 'SELF_ERASE', atMs, address: a.address, size: a.size, before: id, after: null, erased: true });
  }
  private writeValue(type: FieldType, offset: number, value: Value): void {
    if (typeof type === 'string') {
      if (type === 'bool') { if (typeof value !== 'boolean') throw new Error('E_BOOL'); this.bytes.writeUInt8(value ? 1 : 0, offset); return; }
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('E_NUMBER');
      if (type === 'u8') this.bytes.writeUInt8(value, offset);
      else if (type === 'u16') this.bytes.writeUInt16LE(value, offset);
      else if (type === 'u32') this.bytes.writeUInt32LE(value, offset);
      else if (type === 'i32') this.bytes.writeInt32LE(value, offset);
      else if (type === 'f32') this.bytes.writeFloatLE(value, offset);
      else this.bytes.writeDoubleLE(value, offset);
      return;
    }
    if ('enum' in type) { const n = type.enum.indexOf(String(value)); if (n < 0) throw new Error('E_ENUM'); this.bytes.writeUInt32LE(n, offset); }
    else if ('ref' in type) this.bytes.writeUInt32LE(value === null ? 0 : this.allocation(String(value)).address, offset);
    else if ('stringRef' in type) {
      if (typeof value !== 'string') throw new Error('E_STRING');
      const data = Buffer.from(value, 'utf8'), at = align(this.cursor, 4); this.checkRange(at, Math.max(1, data.length));
      data.copy(this.bytes, at - this.base); this.strings.set(at, data.length); this.cursor = at + Math.max(1, data.length); this.bytes.writeUInt32LE(at, offset);
    }
    else if ('bytes' in type) { if (!(value instanceof Uint8Array) || value.length !== type.bytes) throw new Error('E_BYTES'); Buffer.from(value).copy(this.bytes, offset); }
    else { if (!Array.isArray(value) || value.length !== type.length) throw new Error('E_ARRAY'); for (let i = 0; i < type.length; i++) this.writeValue(type.array, offset + i * typeSize(type.array), value[i]); }
  }
  private readValue(type: FieldType, offset: number): Value {
    if (typeof type === 'string') {
      if (type === 'bool') return this.bytes.readUInt8(offset) !== 0;
      if (type === 'u8') return this.bytes.readUInt8(offset);
      if (type === 'u16') return this.bytes.readUInt16LE(offset);
      if (type === 'u32') return this.bytes.readUInt32LE(offset);
      if (type === 'i32') return this.bytes.readInt32LE(offset);
      if (type === 'f32') return this.bytes.readFloatLE(offset);
      return this.bytes.readDoubleLE(offset);
    }
    if ('enum' in type) return type.enum[this.bytes.readUInt32LE(offset)] ?? 'INVALID';
    if ('ref' in type) { const addr = this.bytes.readUInt32LE(offset); return [...this.allocations.values()].find(a => a.address === addr)?.id ?? null; }
    if ('stringRef' in type) { const addr = this.bytes.readUInt32LE(offset), length = this.strings.get(addr); return length === undefined ? '' : this.bytes.toString('utf8', addr - this.base, addr - this.base + length); }
    if ('bytes' in type) return Uint8Array.from(this.bytes.subarray(offset, offset + type.bytes));
    return Array.from({ length: type.length }, (_, i) => this.readValue(type.array, offset + i * typeSize(type.array)));
  }
  snapshot(): StoreSnapshot { return structuredClone({ bytes: Uint8Array.from(this.bytes), allocations: [...this.allocations.values()], strings: [...this.strings], cursor: this.cursor, changes: [...this.changes] }); }
  restore(snapshot: StoreSnapshot): void {
    Buffer.from(snapshot.bytes).copy(this.bytes); this.allocations.clear();
    for (const a of snapshot.allocations) this.allocations.set(a.id, structuredClone(a));
    this.strings = new Map(snapshot.strings); this.cursor = snapshot.cursor; this.changes.clear();
    for (const [key, value] of snapshot.changes) this.changes.set(key, structuredClone(value));
  }
}
