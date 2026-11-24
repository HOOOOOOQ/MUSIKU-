/**
 * Generic in-memory fake for Mongoose models used in tests.
 * Supports the subset of the Mongoose API used by MUSIKU+ services:
 * create, findOne, find, findById, findOneAndUpdate, findByIdAndUpdate,
 * updateOne, updateMany, deleteOne, deleteMany, countDocuments,
 * aggregate ($match/$group), insertMany, findByIdAndDelete, save().
 * Query chaining: sort / skip / limit / lean / populate / select.
 */

let idCounter = 0;
const nextId = (): string => `fake-id-${++idCounter}`;

type Doc = Record<string, unknown> & { _id: string };

function matches(doc: Doc, filter: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (key === '$or') {
      const clauses = value as Record<string, unknown>[];
      if (!clauses.some((c) => matches(doc, c))) return false;
      continue;
    }
    if (key === '$and') {
      const clauses = value as Record<string, unknown>[];
      if (!clauses.every((c) => matches(doc, c))) return false;
      continue;
    }
    const docVal = doc[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      const ops = value as Record<string, unknown>;
      if ('$in' in ops) {
        if (!Array.isArray(ops.$in) || !ops.$in.some((v) => String(v) === String(docVal))) return false;
        continue;
      }
      if ('$ne' in ops) {
        if (String(docVal) === String(ops.$ne)) return false;
        continue;
      }
      if ('$gt' in ops) {
        if (!(new Date(docVal as string).getTime() > new Date(ops.$gt as string).getTime())) return false;
        continue;
      }
      if ('$regex' in ops) {
        const re = new RegExp(String(ops.$regex), (ops.$options as string) ?? '');
        if (!re.test(String(docVal ?? ''))) return false;
        continue;
      }
      if ('$exists' in ops) {
        const exists = docVal !== undefined;
        if (exists !== Boolean(ops.$exists)) return false;
        continue;
      }
      // Nested equality (e.g. { user: { $ne: id } } handled above; plain object = deep compare skip)
      if (JSON.stringify(docVal) !== JSON.stringify(value)) return false;
      continue;
    }
    if (String(docVal) !== String(value)) return false;
  }
  return true;
}

function applyUpdate(doc: Doc, update: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(update)) {
    if (key === '$set') {
      Object.assign(doc, value as Record<string, unknown>);
    } else if (key === '$setOnInsert') {
      // Only meaningful on upsert; handled by caller.
      void value;
    } else if (key === '$inc') {
      for (const [k, v] of Object.entries(value as Record<string, number>)) {
        doc[k] = (Number(doc[k] ?? 0) + v) as unknown as string;
      }
    } else if (key === '$unset') {
      for (const k of Object.keys(value as Record<string, unknown>)) delete doc[k];
    } else {
      doc[key] = value;
    }
  }
}

class FakeQuery<T> implements PromiseLike<T> {
  private sortSpec: Record<string, number> = {};
  private skipN = 0;
  private limitN = Infinity;
  private leanMode = false;

  constructor(private docs: Doc[], private single: boolean) {}

  sort(spec: Record<string, number>): this {
    this.sortSpec = spec;
    return this;
  }
  skip(n: number): this {
    this.skipN = n;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  lean(): this {
    this.leanMode = true;
    return this;
  }
  populate(): this {
    return this;
  }
  select(): this {
    return this;
  }

  private execute(): T {
    let rows = [...this.docs];
    const entries = Object.entries(this.sortSpec);
    if (entries.length > 0) {
      const [field, dir] = entries[0];
      rows.sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        if (av === bv) return 0;
        const cmp = String(av) > String(bv) ? 1 : -1;
        return dir === -1 ? -cmp : cmp;
      });
    }
    if (this.skipN > 0) rows = rows.slice(this.skipN);
    if (this.limitN !== Infinity) rows = rows.slice(0, this.limitN);
    const out = this.leanMode ? rows.map((r) => ({ ...r })) : rows.map((r) => wrapDoc(r));
    return (this.single ? out[0] ?? null : out) as T;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected);
  }
}

function wrapDoc(doc: Doc): Doc & { save: () => Promise<Doc>; toObject: () => Doc } {
  const wrapped = doc as Doc & { save: () => Promise<Doc>; toObject: () => Doc };
  wrapped.save = async () => wrapped;
  wrapped.toObject = () => ({ ...doc });
  return wrapped;
}

export interface FakeModel {
  create: (doc: Record<string, unknown>) => Promise<Doc>;
  findOne: (filter?: Record<string, unknown>) => FakeQuery<Doc | null>;
  find: (filter?: Record<string, unknown>) => FakeQuery<Doc[]>;
  findById: (id: string) => FakeQuery<Doc | null>;
  findOneAndUpdate: (filter: Record<string, unknown>, update: Record<string, unknown>, opts?: { upsert?: boolean; new?: boolean }) => Promise<Doc | null>;
  findByIdAndUpdate: (id: string, update: Record<string, unknown>, opts?: { new?: boolean }) => Promise<Doc | null>;
  findByIdAndDelete: (id: string) => Promise<Doc | null>;
  updateOne: (filter: Record<string, unknown>, update: Record<string, unknown>) => Promise<{ modifiedCount: number }>;
  updateMany: (filter: Record<string, unknown>, update: Record<string, unknown>) => Promise<{ modifiedCount: number }>;
  deleteOne: (filter: Record<string, unknown>) => Promise<{ deletedCount: number }>;
  deleteMany: (filter: Record<string, unknown>) => Promise<{ deletedCount: number }>;
  countDocuments: (filter?: Record<string, unknown>) => Promise<number>;
  aggregate: (pipeline: Record<string, unknown>[]) => Promise<Doc[]>;
  insertMany: (docs: Record<string, unknown>[]) => Promise<Doc[]>;
  _docs: Doc[];
  _reset: () => void;
}

export function createFakeModel(): FakeModel {
  const docs: Doc[] = [];

  const model: FakeModel = {
    _docs: docs,
    _reset: () => {
      docs.length = 0;
    },
    create: async (doc) => {
      const full: Doc = { _id: nextId(), createdAt: new Date(), updatedAt: new Date(), ...doc };
      docs.push(full);
      return wrapDoc(full);
    },
    findOne: (filter = {}) => new FakeQuery<Doc | null>(docs.filter((d) => matches(d, filter)), true),
    find: (filter = {}) => new FakeQuery<Doc[]>(docs.filter((d) => matches(d, filter)), false),
    findById: (id) => new FakeQuery<Doc | null>(docs.filter((d) => String(d._id) === String(id)), true),
    findOneAndUpdate: async (filter, update, opts = {}) => {
      const found = docs.find((d) => matches(d, filter));
      if (found) {
        applyUpdate(found, update);
        found.updatedAt = new Date();
        return wrapDoc(found);
      }
      if (opts.upsert) {
        const base: Record<string, unknown> = { _id: nextId(), createdAt: new Date(), updatedAt: new Date() };
        for (const [k, v] of Object.entries(filter)) {
          if (!k.startsWith('$')) base[k] = v;
        }
        if (update.$setOnInsert) Object.assign(base, update.$setOnInsert as Record<string, unknown>);
        applyUpdate(base as Doc, update);
        docs.push(base as Doc);
        return wrapDoc(base as Doc);
      }
      return null;
    },
    findByIdAndUpdate: async (id, update, opts = {}) => {
      const found = docs.find((d) => String(d._id) === String(id));
      if (!found) return null;
      applyUpdate(found, update);
      void opts;
      return wrapDoc(found);
    },
    findByIdAndDelete: async (id) => {
      const idx = docs.findIndex((d) => String(d._id) === String(id));
      if (idx === -1) return null;
      return docs.splice(idx, 1)[0];
    },
    updateOne: async (filter, update) => {
      const found = docs.find((d) => matches(d, filter));
      if (!found) return { modifiedCount: 0 };
      applyUpdate(found, update);
      return { modifiedCount: 1 };
    },
    updateMany: async (filter, update) => {
      let n = 0;
      for (const d of docs) {
        if (matches(d, filter)) {
          applyUpdate(d, update);
          n += 1;
        }
      }
      return { modifiedCount: n };
    },
    deleteOne: async (filter) => {
      const idx = docs.findIndex((d) => matches(d, filter));
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },
    deleteMany: async (filter) => {
      let n = 0;
      for (let i = docs.length - 1; i >= 0; i -= 1) {
        if (matches(docs[i], filter)) {
          docs.splice(i, 1);
          n += 1;
        }
      }
      return { deletedCount: n };
    },
    countDocuments: async (filter = {}) => docs.filter((d) => matches(d, filter)).length,
    aggregate: async (pipeline) => {
      let rows: Doc[] = [...docs];
      for (const stage of pipeline) {
        if (stage.$match) rows = rows.filter((d) => matches(d, stage.$match as Record<string, unknown>));
        if (stage.$group) {
          const group = stage.$group as Record<string, unknown>;
          const keyField = String(group._id).replace('$', '');
          const map = new Map<string, Doc>();
          for (const r of rows) {
            const key = String(r[keyField] ?? '');
            const existing = map.get(key) ?? { _id: key, count: 0 };
            existing.count = Number(existing.count ?? 0) + 1;
            map.set(key, existing);
          }
          rows = Array.from(map.values());
        }
      }
      return rows;
    },
    insertMany: async (newDocs) => {
      const out: Doc[] = [];
      for (const d of newDocs) {
        const full: Doc = { _id: nextId(), createdAt: new Date(), updatedAt: new Date(), ...d };
        docs.push(full);
        out.push(wrapDoc(full));
      }
      return out;
    },
  };
  return model;
}
