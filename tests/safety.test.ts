import { beforeEach, describe, expect, test } from 'vitest';
import { Db } from '../src/db';
import { man, swipe, woman, type Person } from './factory';

let db: Db;
let noa: Person, yoni: Person, matchId: string;

beforeEach(async () => {
  db = await Db.create({ seed: false });
  noa = await woman(db); yoni = await man(db);
  await swipe(db, noa, yoni);
  matchId = (await swipe(db, yoni, noa))!;
  await db.as(noa.id, (q) => q.rows(`insert into messages (match_id, sender, body) values ($1, $2, 'שלום')`, [matchId, noa.id]));
});

const send = (p: Person, body = 'עוד הודעה') =>
  db.as(p.id, (q) => q.rows(`insert into messages (match_id, sender, body) values ($1, $2, $3)`, [matchId, p.id, body]));
const thread = (p: Person) => db.as(p.id, (q) => q.rows(`select body from messages where match_id = $1`, [matchId]));
const matchList = (p: Person) => db.as(p.id, (q) => q.rows(`select partner_id from my_matches()`));
const profileIds = (p: Person) => db.as(p.id, (q) => q.rows(`select id from profiles`)).then((r) => r.map((x) => x.id));

describe('block', () => {
  test('ends the match at once: chat closed and history hidden for both', async () => {
    await db.as(yoni.id, (q) => q.rows(`select block_user($1)`, [noa.id]));
    await expect(send(noa)).rejects.toThrow(/row-level security/);
    await expect(send(yoni)).rejects.toThrow(/row-level security/);
    expect(await thread(noa)).toHaveLength(0);
    expect(await matchList(noa)).toHaveLength(0);
    expect(await matchList(yoni)).toHaveLength(0);
  });

  test('blocked people cannot read each other\'s profile any more', async () => {
    expect(await profileIds(noa)).toContain(yoni.id);
    await db.as(noa.id, (q) => q.rows(`select block_user($1)`, [yoni.id]));
    expect(await profileIds(noa)).toEqual([noa.id]);
    expect(await profileIds(yoni)).toEqual([yoni.id]);
  });

  test('the blocked person cannot find out who blocked them', async () => {
    await db.as(noa.id, (q) => q.rows(`select block_user($1)`, [yoni.id]));
    expect(await db.as(yoni.id, (q) => q.rows(`select * from blocks`))).toHaveLength(0);
    const m = await db.as(yoni.id, (q) => q.rows(`select id, ended_at from matches`));
    expect(m).toHaveLength(1);   // he sees the match ended...
    await expect(db.as(yoni.id, (q) => q.rows(`select ended_reason from matches`)))
      .rejects.toThrow(/permission denied/); // ...but not whether it was a block
  });

  test('a blocked pair can never match again', async () => {
    const dana = await woman(db); const avi = await man(db);
    await db.as(dana.id, (q) => q.rows(`select block_user($1)`, [avi.id]));
    await expect(swipe(db, avi, dana)).rejects.toThrow(/not available/);
    await expect(swipe(db, dana, avi)).rejects.toThrow(/not available/);
  });
});

describe('unmatch', () => {
  test('either person can unmatch; chat closes for both', async () => {
    await db.as(yoni.id, (q) => q.rows(`select unmatch($1)`, [matchId]));
    await expect(send(noa)).rejects.toThrow(/row-level security/);
    expect(await matchList(noa)).toHaveLength(0);
  });

  test('outsiders cannot unmatch other people', async () => {
    const other = await man(db);
    await expect(db.as(other.id, (q) => q.rows(`select unmatch($1)`, [matchId]))).rejects.toThrow(/no active match/);
  });
});

describe('report', () => {
  test('reporting also blocks, and duplicate open reports are refused', async () => {
    await db.as(noa.id, (q) => q.rows(`select report_user($1, 'harassment', 'הודעות פוגעניות')`, [yoni.id]));
    await expect(send(yoni)).rejects.toThrow(/row-level security/);
    await expect(db.as(noa.id, (q) => q.rows(`select report_user($1, 'other')`, [yoni.id]))).rejects.toThrow(/already reported/);
  });

  test('the reported person never sees the report; the reporter sees only their own', async () => {
    await db.as(noa.id, (q) => q.rows(`select report_user($1, 'fake_profile')`, [yoni.id]));
    expect(await db.as(yoni.id, (q) => q.rows(`select id from reports`))).toHaveLength(0);
    expect(await db.as(noa.id, (q) => q.rows(`select id, reason from reports`))).toHaveLength(1);
  });

  test('unknown reasons are rejected', async () => {
    await expect(db.as(noa.id, (q) => q.rows(`select report_user($1, 'boring')`, [yoni.id]))).rejects.toThrow(/check constraint/);
  });
});
