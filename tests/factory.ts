import type { Db } from '../src/db';
import { newUser, register, type Signup } from './helpers';

export interface Person { id: string; phone: string }

/** Register and verify an adult in one go. */
export async function adult(db: Db, s: Signup & { age?: number } = {}): Promise<Person> {
  const u = newUser();
  await register(db, u, s);
  const d = new Date();
  d.setFullYear(d.getFullYear() - (s.age ?? 30));
  await db.asService((q) => q.rows(`select service_record_verification($1, $2, $3, true)`, [u.id, `ref-${u.id}`, d.toISOString().slice(0, 10)]));
  return u;
}

export const woman = (db: Db, s: Signup & { age?: number } = {}) => adult(db, { gender: 'woman', seeking: ['man'], ...s });
export const man = (db: Db, s: Signup & { age?: number } = {}) => adult(db, { gender: 'man', seeking: ['woman'], name: 'יונתן', ...s });

export const swipe = (db: Db, from: Person, to: Person, dir: 'like' | 'pass' = 'like') =>
  db.as(from.id, (q) => q.val<string | null>(`select swipe($1, $2)`, [to.id, dir]));
