import { describe, expect, test } from 'vitest';
import { Db } from '../src/db';

const NOA = '00000000-0000-4000-a000-000000000010';
const AVIV = '00000000-0000-4000-a000-000000000012';
const DANA = '00000000-0000-4000-a000-000000000014';
const MAYA = '00000000-0000-4000-a000-000000000015';
const OMER = '00000000-0000-4000-a000-000000000016';

describe('seed data (local development)', () => {
  test('loads, and the rules hold on it', async () => {
    const db = await Db.create();
    // Noa already matched with Yonatan, so her deck shows Aviv only (Omer is unverified).
    expect((await db.as(NOA, (q) => q.rows(`select id from discover()`))).map((r) => r.id)).toEqual([AVIV]);
    expect(await db.as(NOA, (q) => q.rows(`select body from messages`))).toHaveLength(2);
    // Same-gender matching works too.
    expect((await db.as(DANA, (q) => q.rows(`select id from discover()`))).map((r) => r.id)).toEqual([MAYA]);
    // Unverified Omer cannot swipe.
    await expect(db.as(OMER, (q) => q.rows(`select swipe($1, 'like')`, [NOA]))).rejects.toThrow(/verify/);
  });
});
