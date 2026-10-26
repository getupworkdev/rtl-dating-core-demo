import { beforeEach, describe, expect, test } from 'vitest';
import { Db } from '../src/db';
import { register } from './helpers';
import { man, swipe, woman } from './factory';

let db: Db;
beforeEach(async () => { db = await Db.create({ seed: false }); });

const count = async (sql: string, params: unknown[] = []) =>
  (await db.pg.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params)).rows[0].n;

describe('delete my account', () => {
  test('removes profile, swipes, matches and the conversation for both sides', async () => {
    const noa = await woman(db); const yoni = await man(db);
    await swipe(db, noa, yoni);
    const m = await swipe(db, yoni, noa);
    await db.as(noa.id, (q) => q.rows(`insert into messages (match_id, sender, body) values ($1, $2, 'שלום')`, [m, noa.id]));

    await db.as(noa.id, (q) => q.rows(`select delete_my_account()`));

    expect(await count(`profiles where id = $1`, [noa.id])).toBe(0);
    expect(await count(`swipes where $1 in (swiper, target)`, [noa.id])).toBe(0);
    expect(await count(`matches`)).toBe(0);
    expect(await count(`messages`)).toBe(0);
    expect(await db.as(yoni.id, (q) => q.rows(`select * from my_matches()`))).toHaveLength(0);
  });

  test('reports are kept for moderation without the deleted user', async () => {
    const noa = await woman(db); const yoni = await man(db);
    await db.as(noa.id, (q) => q.rows(`select report_user($1, 'scam')`, [yoni.id]));
    await db.as(yoni.id, (q) => q.rows(`select delete_my_account()`));
    const r = (await db.pg.query(`select reporter, reported, reason from reports`)).rows;
    expect(r).toEqual([{ reporter: noa.id, reported: null, reason: 'scam' }]);
  });

  test('the same phone can sign up again after deleting (unless it was blocked as under 18)', async () => {
    const noa = await woman(db);
    await db.as(noa.id, (q) => q.rows(`select delete_my_account()`));
    await expect(register(db, noa)).resolves.toBeDefined();
  });

  test('you can only delete yourself', async () => {
    const noa = await woman(db);
    await expect(db.asAnon((q) => q.rows(`select delete_my_account()`))).rejects.toThrow(/permission denied/);
    await expect(db.as(noa.id, (q) => q.rows(`delete from profiles`))).rejects.toThrow(/permission denied/);
  });
});
