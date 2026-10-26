// Test harness: real Postgres (PGlite) running the migrations in order, with helpers to act as
// a signed-in member (role `authenticated`, auth.uid() = id), as the backend (`service_role`),
// exactly the way requests arrive on Supabase.
import { PGlite } from '@electric-sql/pglite';
import shim from '../supabase/test-shim.sql?raw';

const migrations = import.meta.glob('../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const seeds = import.meta.glob('../supabase/seed.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export class Db {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(readonly pg: PGlite) {}

  static async create({ seed = true } = {}): Promise<Db> {
    const pg = await PGlite.create();
    await pg.exec(shim);
    for (const file of Object.keys(migrations).sort()) await pg.exec(migrations[file]);
    if (seed) for (const sql of Object.values(seeds)) await pg.exec(sql);
    return new Db(pg);
  }

  /** Run as a signed-in app user (phone verified by OTP at sign-in). Row-level security applies. */
  as<T>(userId: string, fn: (q: Q) => Promise<T>, phone?: string) {
    if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error('bad user id');
    if (phone && !/^\+[0-9]{8,15}$/.test(phone)) throw new Error('bad phone');
    const claims = JSON.stringify({ sub: userId, role: 'authenticated', ...(phone ? { phone } : {}) });
    return this.run(`set role authenticated; set request.jwt.claims = '${claims}';`, fn);
  }

  /** Run as a signed-out visitor. */
  asAnon<T>(fn: (q: Q) => Promise<T>) {
    return this.run(`set role anon; reset request.jwt.claims;`, fn);
  }

  /** Run as the backend (Edge Function with the service key), e.g. the verification webhook. */
  asService<T>(fn: (q: Q) => Promise<T>) {
    return this.run(`set role service_role; reset request.jwt.claims;`, fn);
  }

  private run<T>(setup: string, fn: (q: Q) => Promise<T>): Promise<T> {
    const go = async () => {
      await this.pg.exec(setup);
      try { return await fn(new Q(this.pg)); }
      finally { await this.pg.exec('reset role; reset request.jwt.claims;'); }
    };
    const p = this.queue.then(go, go);
    this.queue = p.catch(() => undefined);
    return p;
  }
}

export class Q {
  constructor(private pg: PGlite) {}
  async rows<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pg.query<T>(sql, params)).rows;
  }
  async val<T = any>(sql: string, params: unknown[] = []): Promise<T> {
    const r = await this.rows<Record<string, T>>(sql, params);
    return r.length ? Object.values(r[0])[0] : (undefined as T);
  }
}
