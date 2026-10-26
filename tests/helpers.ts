import { Db, type Q } from '../src/db';

let n = 0;
/** A fresh user id + phone, not in the seed. */
export function newUser() {
  n++;
  const id = `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
  const phone = `+97252${String(1000000 + n).slice(-7)}`;
  return { id, phone };
}

export interface Signup {
  name?: string; gender?: 'woman' | 'man'; seeking?: string[]; ageMin?: number; ageMax?: number; city?: string;
}

export function register(db: Db, u: { id: string; phone: string }, s: Signup = {}) {
  return db.as(u.id, (q) =>
    q.rows(`select register_profile($1, $2, $3, $4, $5, $6, '')`, [
      s.name ?? 'נועה', s.gender ?? 'woman', s.seeking ?? ['man'], s.ageMin ?? 25, s.ageMax ?? 40, s.city ?? 'תל אביב',
    ]), u.phone);
}

export const myProfile = (q: Q) => q.rows(`select * from my_profile()`).then((r) => r[0]);
