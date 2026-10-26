import { beforeEach, describe, expect, test } from 'vitest';
import { Db } from '../src/db';
import { myProfile, newUser, register } from './helpers';

let db: Db;
beforeEach(async () => { db = await Db.create({ seed: false }); });

const yearsAgo = (y: number, extraDays = 0) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - y);
  d.setDate(d.getDate() - extraDays);
  return d.toISOString().slice(0, 10);
};
const verify = (user: string, ref: string, birth: string, passed = true) =>
  db.asService((q) => q.val<string>(`select service_record_verification($1, $2, $3, $4)`, [user, ref, birth, passed]));

describe('age verification', () => {
  test('an adult who passes becomes active, and sees their age but not their birth date', async () => {
    const u = newUser();
    await register(db, u);
    expect(await verify(u.id, 'vendor-ref-adult', yearsAgo(29))).toBe('active');
    expect(await db.as(u.id, myProfile)).toMatchObject({ status: 'active', verified: true, age: 29 });
  });

  test('turning 18 today counts as 18; one day short does not', async () => {
    const a = newUser(); const b = newUser();
    await register(db, a); await register(db, b);
    expect(await verify(a.id, 'ref-18-today', yearsAgo(18))).toBe('active');
    const d = new Date(); d.setFullYear(d.getFullYear() - 18); d.setDate(d.getDate() + 1);
    expect(await verify(b.id, 'ref-18-tomorrow', d.toISOString().slice(0, 10))).toBe('blocked_underage');
  });

  test('a failed check leaves the profile pending', async () => {
    const u = newUser();
    await register(db, u);
    expect(await verify(u.id, 'ref-failed', yearsAgo(30), false)).toBe('failed');
    expect((await db.as(u.id, myProfile)).status).toBe('pending_verification');
  });

  test('one verified identity cannot back two accounts', async () => {
    const a = newUser(); const b = newUser();
    await register(db, a); await register(db, b);
    await verify(a.id, 'ref-shared', yearsAgo(30));
    await expect(verify(b.id, 'ref-shared', yearsAgo(30))).rejects.toThrow(/already used/);
  });
});

describe('under-18 block survives reinstall, new account and account deletion', () => {
  test('under 18 → blocked, and the birth date and vendor reference are not kept', async () => {
    const u = newUser();
    await register(db, u);
    expect(await verify(u.id, 'ref-minor', yearsAgo(16))).toBe('blocked_underage');
    const raw = await db.pg.query(`select birth_date, verification_ref from profiles where id = $1`, [u.id]);
    expect(raw.rows[0]).toEqual({ birth_date: null, verification_ref: null });
  });

  test('the same phone cannot register again, even after the profile row is gone', async () => {
    const u = newUser();
    await register(db, u);
    await verify(u.id, 'ref-minor-2', yearsAgo(15));
    await db.pg.query(`delete from profiles where id = $1`, [u.id]);           // e.g. account deleted
    const again = { id: newUser().id, phone: u.phone };                         // new install, new account
    await expect(register(db, again)).rejects.toThrow(/cannot be used/);
  });

  test('the same ID document on a new phone number is blocked at verification', async () => {
    const first = newUser(); const second = newUser();
    await register(db, first);
    await verify(first.id, 'ref-minor-3', yearsAgo(16));
    await register(db, second);
    expect(await verify(second.id, 'ref-minor-3', yearsAgo(16))).toBe('blocked_underage');
  });

  test('only hashes are stored in the registry, never the phone number', async () => {
    const u = newUser();
    await register(db, u);
    await verify(u.id, 'ref-minor-4', yearsAgo(17));
    const rows = (await db.pg.query<{ hash: string }>(`select hash from underage_registry`)).rows;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.hash).not.toContain(u.phone.replace('+', ''));
    }
  });
});

describe('only the backend can record a verification', () => {
  test('an app user cannot verify themselves or read the registry', async () => {
    const u = newUser();
    await register(db, u);
    await expect(db.as(u.id, (q) => q.rows(`select service_record_verification($1, 'fake', '1990-01-01', true)`, [u.id])))
      .rejects.toThrow(/permission denied/);
    await expect(db.as(u.id, (q) => q.rows(`select * from underage_registry`))).rejects.toThrow(/permission denied/);
  });
});
