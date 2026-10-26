import { beforeEach, describe, expect, test } from 'vitest';
import { Db } from '../src/db';
import { newUser, register } from './helpers';
import { man, swipe, woman } from './factory';

let db: Db;
beforeEach(async () => { db = await Db.create({ seed: false }); });

describe('mutual match', () => {
  test('a one-way like is not a match', async () => {
    const noa = await woman(db); const yoni = await man(db);
    expect(await swipe(db, noa, yoni)).toBeNull();
    expect(await db.as(yoni.id, (q) => q.rows(`select id from matches`))).toHaveLength(0);
  });

  test('the second like creates the match, visible to both', async () => {
    const noa = await woman(db); const yoni = await man(db);
    await swipe(db, noa, yoni);
    const id = await swipe(db, yoni, noa);
    expect(id).toMatch(/[0-9a-f-]{36}/);
    expect((await db.as(noa.id, (q) => q.rows(`select id from matches`))).map((m) => m.id)).toEqual([id]);
    expect((await db.as(yoni.id, (q) => q.rows(`select id from matches`))).map((m) => m.id)).toEqual([id]);
  });

  test('like + pass is not a match', async () => {
    const noa = await woman(db); const yoni = await man(db);
    await swipe(db, noa, yoni);
    expect(await swipe(db, yoni, noa, 'pass')).toBeNull();
  });

  test('both liking at the same moment creates exactly one match', async () => {
    for (let i = 0; i < 5; i++) {
      const a = await woman(db); const b = await man(db);
      const [x, y] = await Promise.all([swipe(db, a, b), swipe(db, b, a)]);
      expect([x, y].filter(Boolean)).toHaveLength(1);
      const n = await db.pg.query(`select count(*)::int as n from matches where $1 in (user_a, user_b)`, [a.id]);
      expect(n.rows[0]).toEqual({ n: 1 });
    }
  });

  test('a double tap is refused, not double counted', async () => {
    const noa = await woman(db); const yoni = await man(db);
    await swipe(db, noa, yoni);
    await expect(swipe(db, noa, yoni)).rejects.toThrow(/already swiped/);
    await expect(swipe(db, noa, yoni, 'pass')).rejects.toThrow(/already swiped/);
  });

  test('nobody can see who liked them', async () => {
    const noa = await woman(db); const yoni = await man(db);
    await swipe(db, noa, yoni);
    expect(await db.as(yoni.id, (q) => q.rows(`select * from swipes`))).toHaveLength(0);
    expect(await db.as(noa.id, (q) => q.rows(`select * from swipes`))).toHaveLength(1);
  });

  test('swipes and matches cannot be written directly', async () => {
    const noa = await woman(db); const yoni = await man(db);
    await expect(db.as(noa.id, (q) => q.rows(`insert into matches (user_a, user_b) values ($1, $2)`, [noa.id, yoni.id].sort())))
      .rejects.toThrow(/permission denied/);
    await expect(db.as(noa.id, (q) => q.rows(`insert into swipes values ($1, $2, 'like')`, [yoni.id, noa.id])))
      .rejects.toThrow(/permission denied/);
  });
});

describe('a modified app cannot like people it would never be shown', () => {
  test('unverified users cannot swipe, and cannot be swiped', async () => {
    const pending = newUser();
    await register(db, pending);
    const yoni = await man(db);
    await expect(swipe(db, pending, yoni)).rejects.toThrow(/verify your profile/);
    await expect(swipe(db, yoni, pending)).rejects.toThrow(/not available/);
  });

  test('orientation must match both ways', async () => {
    const noa = await woman(db);
    const dana = await woman(db, { name: 'דנה' });
    await expect(swipe(db, noa, dana)).rejects.toThrow(/not available/);
  });

  test("age must be inside both people's ranges", async () => {
    const noa = await woman(db, { age: 30, ageMin: 28, ageMax: 35 });
    const older = await man(db, { age: 45, ageMin: 25, ageMax: 50 });
    await expect(swipe(db, noa, older)).rejects.toThrow(/not available/);
    await expect(swipe(db, older, noa)).rejects.toThrow(/not available/);
  });

  test('you cannot like yourself', async () => {
    const noa = await woman(db, { seeking: ['man', 'woman'] });
    await expect(swipe(db, noa, noa)).rejects.toThrow(/not available/);
  });
});
