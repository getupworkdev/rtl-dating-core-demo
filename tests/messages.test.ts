import { beforeEach, describe, expect, test } from 'vitest';
import { Db } from '../src/db';
import { man, swipe, woman, type Person } from './factory';

let db: Db;
let noa: Person, yoni: Person, other: Person, matchId: string;

beforeEach(async () => {
  db = await Db.create({ seed: false });
  noa = await woman(db); yoni = await man(db); other = await man(db);
  await swipe(db, noa, yoni);
  matchId = (await swipe(db, yoni, noa))!;
});

const send = (p: Person, body: string, match = matchId, sender = p.id) =>
  db.as(p.id, (q) => q.rows(`insert into messages (match_id, sender, body) values ($1, $2, $3)`, [match, sender, body]));
const read = (p: Person, match = matchId) =>
  db.as(p.id, (q) => q.rows(`select sender, body, read_at from messages where match_id = $1 order by created_at`, [match]));

describe('chat inside a match', () => {
  test('both people can send and read, Hebrew and emoji intact', async () => {
    await send(noa, 'היי יונתן! קפה בשבוע הבא? ☕');
    await send(yoni, 'בשמחה, יום שלישי?');
    const thread = await read(yoni);
    expect(thread.map((m) => m.body)).toEqual(['היי יונתן! קפה בשבוע הבא? ☕', 'בשמחה, יום שלישי?']);
  });

  test('message length counts characters, not bytes', async () => {
    await expect(send(noa, 'א'.repeat(1000))).resolves.toBeDefined();
    await expect(send(noa, 'א'.repeat(1001))).rejects.toThrow(/check constraint/);
    await expect(send(noa, '   ')).rejects.toThrow(/check constraint/);
  });

  test('read receipts: only the recipient marks messages read', async () => {
    await send(noa, 'שלום');
    expect(await db.as(noa.id, (q) => q.val(`select mark_read($1)`, [matchId]))).toBe(0);
    expect(await db.as(yoni.id, (q) => q.val(`select mark_read($1)`, [matchId]))).toBe(1);
    expect((await read(noa))[0].read_at).not.toBeNull();
  });
});

describe('nobody else gets in', () => {
  test('someone outside the match cannot read or send', async () => {
    await send(noa, 'פרטי');
    expect(await read(other)).toHaveLength(0);
    await expect(send(other, 'hi')).rejects.toThrow(/row-level security/);
  });

  test('you cannot send as the other person', async () => {
    await expect(send(noa, 'מזויף', matchId, yoni.id)).rejects.toThrow(/row-level security/);
  });

  test('messages cannot be edited or deleted by clients', async () => {
    await send(noa, 'שלום');
    await expect(db.as(yoni.id, (q) => q.rows(`update messages set body = 'x'`))).rejects.toThrow(/permission denied/);
    await expect(db.as(noa.id, (q) => q.rows(`delete from messages`))).rejects.toThrow(/permission denied/);
  });

  test('a one-way like does not open a chat', async () => {
    await swipe(db, other, noa);
    const fake = (await db.pg.query<{ id: string }>(`select gen_random_uuid() as id`)).rows[0].id;
    await expect(send(other, 'hi', fake)).rejects.toThrow(/row-level security/);
  });
});
