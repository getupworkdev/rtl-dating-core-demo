-- Fictional Hebrew seed data for local development (supabase db reset). No real people or numbers.
insert into profiles (id, phone_e164, display_name, bio, gender, seeking, age_min, age_max, city,
                      birth_date, verification_ref, verified_at, status, is_admin) values
  ('00000000-0000-4000-a000-000000000001','+972500000001','מנהלת המערכת','','woman','{man}',18,99,'תל אביב', current_date - interval '35 years','seed-ref-01',now(),'active',true),
  ('00000000-0000-4000-a000-000000000010','+972500000010','נועה','אוהבת טיולים בגליל וקפה של בוקר','woman','{man}',27,38,'תל אביב', current_date - interval '29 years','seed-ref-10',now(),'active',false),
  ('00000000-0000-4000-a000-000000000011','+972500000011','יונתן','מהנדס, מבשל בשבת','man','{woman}',24,34,'רמת גן', current_date - interval '31 years','seed-ref-11',now(),'active',false),
  ('00000000-0000-4000-a000-000000000012','+972500000012','אביב','מוזיקאי','man','{woman}',25,35,'חיפה', current_date - interval '33 years','seed-ref-12',now(),'active',false),
  ('00000000-0000-4000-a000-000000000013','+972500000013','שירה','רופאה, רצה בבוקר','woman','{man}',28,40,'ירושלים', current_date - interval '32 years','seed-ref-13',now(),'active',false),
  ('00000000-0000-4000-a000-000000000014','+972500000014','דנה','','woman','{woman}',25,40,'תל אביב', current_date - interval '30 years','seed-ref-14',now(),'active',false),
  ('00000000-0000-4000-a000-000000000015','+972500000015','מאיה','','woman','{woman}',25,40,'יפו', current_date - interval '28 years','seed-ref-15',now(),'active',false),
  ('00000000-0000-4000-a000-000000000016','+972500000016','עומר','עדיין לא אומת','man','{woman}',24,35,'באר שבע', null,null,null,'pending_verification',false);

insert into swipes (swiper, target, direction) values
  ('00000000-0000-4000-a000-000000000010','00000000-0000-4000-a000-000000000011','like'),
  ('00000000-0000-4000-a000-000000000011','00000000-0000-4000-a000-000000000010','like');
insert into matches (id, user_a, user_b) values
  ('00000000-0000-4000-b000-000000000001','00000000-0000-4000-a000-000000000010','00000000-0000-4000-a000-000000000011');
insert into messages (match_id, sender, body) values
  ('00000000-0000-4000-b000-000000000001','00000000-0000-4000-a000-000000000010','היי יונתן, ראיתי שגם אתה אוהב לבשל 🙂'),
  ('00000000-0000-4000-b000-000000000001','00000000-0000-4000-a000-000000000011','נכון! מה הכי טוב שיצא לך לאחרונה?');
