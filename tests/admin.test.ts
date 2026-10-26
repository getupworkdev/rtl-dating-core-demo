import { beforeEach, describe, expect, test } from 'vitest';
import { Db } from '../src/db';
import { man, swipe, woman, type Person } from './factory';

let db: Db;
let admin: Person, noa: Person, yoni: Person, avi: Person;

beforeEach(async () => {
  db = await Db.create({ seed: false });
  admin = await woman(db, { name: 'מנהלת' });
  await db.pg.query(`update profiles set is_admin = true where id = $1`, [admin.id]);
  noa = await woman(db); yoni = await man(db); avi = await man(db);
});

const queue = () => db.as(admin.id, (q) => q.rows(`select * from admin_report_queue()`));

describe('moderation queue', () => {
  test('under-18 reports come first', async () => {
    await db.as(noa.id, (q) => q.rows(`select report_user($1, 'scam')`, [yoni.id]));
    await db.as(noa.id, (q) => q.rows(`select report_user($1, 'underage', 'נראה צעיר מאוד')`, [avi.id]));
    expect((await queue()).map((r) => r.reason)).toEqual(['underage', 'scam']);
  });

  test('members cannot see the queue, ban, or read the audit log', async () => {
    await expect(db.as(noa.id, (q) => q.rows(`select * from admin_report_queue()`))).rejects.toThrow(/admin only/);
    await expect(db.as(noa.id, (q) => q.rows(`select admin_ban($1, 'x')`, [yoni.id]))).rejects.toThrow(/admin only/);
    await expect(db.as(noa.id, (q) => q.rows(`select * from audit_log`))).rejects.toThrow(/permission denied/);
  });

  test('nobody can make themselves admin', async () => {
    await expect(db.as(noa.id, (q) => q.rows(`update profiles set is_admin = true where id = $1`, [noa.id])))
      .rejects.toThrow(/permission denied/);
  });
});

describe('ban', () => {
  test('ends matches, closes chats, hides the user, resolves their reports, and is audited', async () => {
    await swipe(db, noa, yoni);
    const m = await swipe(db, yoni, noa);
    await db.as(noa.id, (q) => q.rows(`select report_user($1, 'harassment')`, [avi.id]));

    await db.as(admin.id, (q) => q.rows(`select admin_ban($1, 'repeated harassment')`, [yoni.id]));
    await db.as(admin.id, (q) => q.rows(`select admin_ban($1, 'confirmed by moderator')`, [avi.id]));

    await expect(db.as(noa.id, (q) => q.rows(`insert into messages (match_id, sender, body) values ($1, $2, 'היי')`, [m, noa.id])))
      .rejects.toThrow(/row-level security/);
    expect(await db.as(noa.id, (q) => q.rows(`select * from my_matches()`))).toHaveLength(0);
    await expect(swipe(db, yoni, noa)).rejects.toThrow(/verify your profile/);   // banned users cannot act
    expect(await queue()).toHaveLength(0);
    const audit = await db.as(admin.id, (q) => q.rows(`select action, target from admin_audit()`));
    expect(audit).toEqual([{ action: 'ban', target: avi.id }, { action: 'ban', target: yoni.id }]);
  });

  test('a ban needs a note, and admins cannot ban themselves', async () => {
    await expect(db.as(admin.id, (q) => q.rows(`select admin_ban($1, '  ')`, [yoni.id]))).rejects.toThrow(/note is required/);
    await expect(db.as(admin.id, (q) => q.rows(`select admin_ban($1, 'x')`, [admin.id]))).rejects.toThrow(/yourself/);
  });

  test('the audit log is append-only', async () => {
    await db.as(admin.id, (q) => q.rows(`select admin_ban($1, 'spam')`, [yoni.id]));
    await expect(db.pg.query(`delete from audit_log`)).rejects.toThrow(/append-only/);
    await expect(db.pg.query(`update audit_log set action = 'x'`)).rejects.toThrow(/append-only/);
  });

  test('dismissing a report is audited', async () => {
    const id = await db.as(noa.id, (q) => q.val(`select report_user($1, 'other')`, [yoni.id]));
    await db.as(admin.id, (q) => q.rows(`select admin_dismiss_report($1, 'no violation')`, [id]));
    expect(await queue()).toHaveLength(0);
    expect((await db.as(admin.id, (q) => q.rows(`select action from admin_audit()`)))[0].action).toBe('dismiss_report');
  });
});
