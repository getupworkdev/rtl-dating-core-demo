import { beforeEach, describe, expect, test } from 'vitest';
import { Db } from '../src/db';
import { newUser, register } from './helpers';
import { man, swipe, woman } from './factory';

let db: Db;
beforeEach(async () => { db = await Db.create({ seed: false }); });

const deck = (id: string) => db.as(id, (q) => q.rows(`select * from discover()`));
const ids = async (id: string) => (await deck(id)).map((r) => r.id).sort();

describe('discover deck', () => {
  test('shows eligible people with public fields only', async () => {
    const noa = await woman(db, { age: 30 });
    const yoni = await man(db, { age: 32, name: 'יונתן', city: 'ירושלים' });
    const rows = await deck(noa.id);
    expect(rows).toEqual([{ id: yoni.id, display_name: 'יונתן', age: 32, city: 'ירושלים', bio: '' }]);
  });

  test('excludes yourself, wrong orientation, out-of-range age and unverified users', async () => {
    const noa = await woman(db, { age: 30, ageMin: 28, ageMax: 40 });
    const ok = await man(db, { age: 33 });
    await woman(db, { name: 'דנה' });                                    // orientation
    await man(db, { age: 55, ageMax: 60 });                             // outside Noa's range
    await man(db, { age: 33, ageMin: 18, ageMax: 25 });                 // Noa outside his range
    const pending = newUser(); await register(db, pending, { gender: 'man', seeking: ['woman'] }); // unverified
    expect(await ids(noa.id)).toEqual([ok.id]);
  });

  test('someone you already swiped does not come back', async () => {
    const noa = await woman(db); const a = await man(db); const b = await man(db);
    await swipe(db, noa, a, 'pass');
    expect(await ids(noa.id)).toEqual([b.id]);
  });

  test('blocked and banned users vanish both ways', async () => {
    const noa = await woman(db); const a = await man(db); const b = await man(db);
    await db.pg.query(`insert into blocks (blocker, blocked) values ($1, $2)`, [a.id, noa.id]);
    await db.pg.query(`update profiles set status = 'banned' where id = $1`, [b.id]);
    expect(await ids(noa.id)).toEqual([]);
    expect(await ids(a.id)).toEqual([]);
  });

  test('page size is capped server-side', async () => {
    const noa = await woman(db);
    for (let i = 0; i < 3; i++) await man(db);
    expect(await db.as(noa.id, (q) => q.rows(`select * from discover(2)`))).toHaveLength(2);
    expect(await db.as(noa.id, (q) => q.rows(`select * from discover(100000)`))).toHaveLength(3);
  });
});

describe('profiles outside the deck stay private', () => {
  test('before a match you cannot read anyone else\'s profile row', async () => {
    const noa = await woman(db); await man(db);
    const rows = await db.as(noa.id, (q) => q.rows(`select id, display_name from profiles`));
    expect(rows.map((r) => r.id)).toEqual([noa.id]);
  });

  test('after a match, the partner appears in my_matches and their public columns become readable', async () => {
    const noa = await woman(db); const yoni = await man(db, { name: 'יונתן' });
    await swipe(db, noa, yoni); await swipe(db, yoni, noa);
    const list = await db.as(noa.id, (q) => q.rows(`select partner_id, display_name from my_matches()`));
    expect(list).toEqual([{ partner_id: yoni.id, display_name: 'יונתן' }]);
    const visible = await db.as(noa.id, (q) => q.rows(`select id from profiles order by id`));
    expect(visible.map((r) => r.id).sort()).toEqual([noa.id, yoni.id].sort());
    await expect(db.as(noa.id, (q) => q.rows(`select phone_e164 from profiles where id = $1`, [yoni.id])))
      .rejects.toThrow(/permission denied/);
  });
});
