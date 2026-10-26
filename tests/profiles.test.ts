import { beforeEach, describe, expect, test } from 'vitest';
import { Db } from '../src/db';
import { myProfile, newUser, register } from './helpers';

let db: Db;
beforeEach(async () => { db = await Db.create({ seed: false }); });

describe('registration', () => {
  test('a signed-in user creates their profile; Hebrew text is stored as typed', async () => {
    const u = newUser();
    await register(db, u, { name: '  יעל  ', city: 'חיפה' });
    const me = await db.as(u.id, myProfile);
    expect(me).toMatchObject({ display_name: 'יעל', city: 'חיפה', phone_e164: u.phone, status: 'pending_verification', verified: false });
  });

  test('the phone number comes from the signed-in session, not from the request', async () => {
    const u = newUser();
    await expect(db.as(u.id, (q) => q.rows(`select register_profile('דנה', 'woman', '{man}', 25, 40, 'חיפה', '')`)))
      .rejects.toThrow(/sign in with your phone/);
  });

  test('one profile per account', async () => {
    const u = newUser();
    await register(db, u);
    await expect(register(db, u)).rejects.toThrow(/already exists/);
  });

  test('one account per phone number', async () => {
    const a = newUser(); const b = { ...newUser(), phone: a.phone };
    await register(db, a);
    await expect(register(db, b)).rejects.toThrow(/duplicate key|unique/);
  });

  test.each([
    [{ name: 'א' }, /display_name/],
    [{ ageMin: 16 }, /age_min/],
    [{ ageMin: 40, ageMax: 30 }, /check constraint/],
    [{ seeking: [] }, /seeking/],
    [{ seeking: ['robot'] }, /seeking/],
  ])('rejects invalid input %o', async (s, msg) => {
    await expect(register(db, newUser(), s as never)).rejects.toThrow(msg);
  });

  test('name length counts Hebrew characters, not bytes', async () => {
    // 40 Hebrew letters is 80 bytes in UTF-8 but must still be allowed.
    await expect(register(db, newUser(), { name: 'א'.repeat(40) })).resolves.toBeDefined();
    await expect(register(db, newUser(), { name: 'א'.repeat(41) })).rejects.toThrow(/display_name/);
  });
});

describe('privacy of the profile row', () => {
  test('users cannot read phone, birth date or status columns, even their own', async () => {
    const u = newUser();
    await register(db, u);
    await expect(db.as(u.id, (q) => q.rows(`select phone_e164 from profiles`))).rejects.toThrow(/permission denied/);
    await expect(db.as(u.id, (q) => q.rows(`select birth_date from profiles`))).rejects.toThrow(/permission denied/);
  });

  test('users cannot verify or activate themselves', async () => {
    const u = newUser();
    await register(db, u);
    await expect(db.as(u.id, (q) => q.rows(`update profiles set status = 'active', verified_at = now()`)))
      .rejects.toThrow(/permission denied/);
    expect((await db.as(u.id, myProfile)).status).toBe('pending_verification');
  });

  test('signed-out visitors see nothing', async () => {
    await register(db, newUser());
    await expect(db.asAnon((q) => q.rows(`select id from profiles`))).rejects.toThrow(/permission denied/);
    await expect(db.asAnon((q) => q.rows(`select * from my_profile()`))).rejects.toThrow(/permission denied/);
  });
});
