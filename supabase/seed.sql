-- Local development seed for `supabase db reset`.
-- Creates a sample Dallas shop with a few quotes in different states.
-- No auth users are seeded: sign in with magic link, then attach yourself with
--   insert into shop_memberships (shop_id, user_id, role)
--   values ('11111111-1111-1111-1111-111111111111', auth.uid(), 'owner');
-- or run create_shop_with_owner from the app's onboarding instead.

insert into shops (id, name, slug, phone, email, reply_to_email, address, website,
  primary_color, default_payment_method, default_payment_handle, quote_expiration_days, follow_up_schedule_days, quote_disclaimer)
values (
  '11111111-1111-1111-1111-111111111111',
  'Big Tex Audio', 'big-tex-audio-seed', '214-555-0100',
  'shop@bigtexaudio.example.com', 'quotes@bigtexaudio.example.com',
  '4820 Ross Ave, Dallas, TX 75204', 'https://bigtexaudio.example.com',
  '#1d4ed8', 'link', 'https://pay.example.com/big-tex-audio/deposit', 30, '{2,3,5}',
  'Final pricing and compatibility may require vehicle inspection. Products and availability are subject to confirmation by the shop.'
);

insert into customers (id, shop_id, first_name, last_name, phone, email,
  vehicle_year, vehicle_make, vehicle_model, vehicle_trim, source,
  email_contact_permission_confirmed, email_contact_permission_confirmed_at)
values
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111111',
   'Marcus', 'Bell', '214-555-0142', 'marcus.bell@example.com',
   2022, 'Ford', 'F-150', 'Lariat', 'Walk-in', true, now() - interval '4 days'),
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111111',
   'Dana', 'Whitfield', '972-555-0178', 'dana.whitfield@example.com',
   2021, 'Chevrolet', 'Silverado 1500', 'LT', 'Phone call', true, now() - interval '6 days'),
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111111',
   'Luis', 'Herrera', '469-555-0111', 'luis.herrera@example.com',
   2023, 'RAM', '1500', 'Big Horn', 'Referral', true, now() - interval '12 days');

insert into quotes (id, shop_id, customer_id, public_token, status, internal_notes,
  expiration_date, last_emailed_at, next_follow_up_at, won_amount_cents)
values
  ('33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222201', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
   'viewed', 'Leaning toward the Better package.', now() + interval '26 days',
   now() - interval '3 days', now(), null),
  ('33333333-3333-3333-3333-333333333302', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222202', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02',
   'responded', 'Asked about financing.', now() + interval '24 days',
   now() - interval '4 days', now() + interval '1 day', null),
  ('33333333-3333-3333-3333-333333333303', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222203', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03',
   'won', 'Came back after check-in email.', now() + interval '18 days',
   now() - interval '9 days', null, 319900);

insert into quote_options (id, quote_id, tier, name, description, price_cents, recommended, position, deposit_payment_method, deposit_payment_handle, deposit_amount_cents)
values
  ('44444444-4444-4444-4444-444444444401', '33333333-3333-3333-3333-333333333301', 'good',
   'Good', 'Solid daily-driver upgrade.', 189900, false, 0, 'link', 'https://pay.example.com/big-tex-audio/deposit', 28485),
  ('44444444-4444-4444-4444-444444444402', '33333333-3333-3333-3333-333333333301', 'better',
   'Better', 'Adds a hidden 10-inch sub under the rear seat.', 289900, true, 1, 'link', 'https://pay.example.com/big-tex-audio/deposit', 43485),
  ('44444444-4444-4444-4444-444444444403', '33333333-3333-3333-3333-333333333301', 'insane',
   'Insane', 'Full front-stage rebuild with DSP tune.', 549900, false, 2, 'link', 'https://pay.example.com/big-tex-audio/deposit', 82485),
  ('44444444-4444-4444-4444-444444444404', '33333333-3333-3333-3333-333333333302', 'good',
   'Good', 'Head unit + speaker refresh.', 149900, false, 0, null, null, null),
  ('44444444-4444-4444-4444-444444444405', '33333333-3333-3333-3333-333333333302', 'better',
   'Better', 'Adds amp + shallow sub behind the seat.', 259900, true, 1, null, null, null),
  ('44444444-4444-4444-4444-444444444406', '33333333-3333-3333-3333-333333333303', 'better',
   'Better', 'Full four-door speaker swap with amp and sub.', 319900, true, 0, null, null, null);

insert into quote_items (quote_option_id, brand, model, name, quantity, position)
values
  ('44444444-4444-4444-4444-444444444401', 'Kicker', 'KEY200.4', '4-channel smart amp', 1, 0),
  ('44444444-4444-4444-4444-444444444401', 'Kicker', 'DS-Series', 'Front + rear speaker set', 1, 1),
  ('44444444-4444-4444-4444-444444444402', 'JL Audio', 'XD600/6v2', '6-channel amplifier', 1, 0),
  ('44444444-4444-4444-4444-444444444402', 'JL Audio', 'Stealthbox', 'Under-seat 10" subwoofer', 1, 1),
  ('44444444-4444-4444-4444-444444444402', 'Focal', 'PS 165', 'Front component speakers', 1, 2),
  ('44444444-4444-4444-4444-444444444403', 'Audison', 'Forza AF M8.14 bit', 'DSP amplifier', 1, 0),
  ('44444444-4444-4444-4444-444444444404', 'Alpine', 'iLX-W670', 'CarPlay receiver', 1, 0),
  ('44444444-4444-4444-4444-444444444405', 'Alpine', 'SS-SB10', 'Shallow 10" loaded enclosure', 1, 0),
  ('44444444-4444-4444-4444-444444444406', 'Rockford Fosgate', 'T400X4ad', '4-channel amplifier', 1, 0),
  ('44444444-4444-4444-4444-444444444406', 'Rockford Fosgate', 'P3-1X12', '12" sub in ported enclosure', 1, 1);

insert into quote_events (quote_id, event_type, metadata)
values
  ('33333333-3333-3333-3333-333333333301', 'created', '{}'),
  ('33333333-3333-3333-3333-333333333301', 'email_sent', '{"templateType": "initial"}'),
  ('33333333-3333-3333-3333-333333333301', 'quote_viewed', '{}'),
  ('33333333-3333-3333-3333-333333333302', 'created', '{}'),
  ('33333333-3333-3333-3333-333333333302', 'email_sent', '{"templateType": "initial"}'),
  ('33333333-3333-3333-3333-333333333302', 'customer_responded', '{"responseType": "need_financing"}'),
  ('33333333-3333-3333-3333-333333333303', 'created', '{}'),
  ('33333333-3333-3333-3333-333333333303', 'marked_won', '{"wonAmountCents": 319900}');

insert into quote_responses (quote_id, quote_option_id, response_type, message)
values
  ('33333333-3333-3333-3333-333333333302', '44444444-4444-4444-4444-444444444405',
   'need_financing', 'Can I split this over a few months?');

insert into email_messages (shop_id, quote_id, recipient_email, template_type, subject, status, sent_at)
values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333301',
   'marcus.bell@example.com', 'initial', 'Your 2022 Ford F-150 audio quote from Big Tex Audio', 'sent', now() - interval '3 days'),
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333302',
   'dana.whitfield@example.com', 'initial', 'Your 2021 Chevrolet Silverado 1500 audio quote from Big Tex Audio', 'sent', now() - interval '4 days');
