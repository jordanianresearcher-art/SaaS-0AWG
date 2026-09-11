-- 0028: a conversation on the quote itself.
--
-- Today a customer's only way to say something is to pick one of six canned
-- responses (quote_responses) and optionally leave a note. The shop cannot
-- answer in the app at all — it replies by phone or by a separate email, and
-- whatever was agreed lives in someone's head or their personal texts.
--
-- That costs the shop twice. The obvious cost is friction: "can you do it
-- Saturday instead?" needs a phone call. The quiet one is attribution — five
-- weeks into the pilot, eight jobs are recorded as won and not one carries a
-- record of the conversation that closed it, because the conversation never
-- happened here.
--
-- The customer never authenticates. They hold a public_token and nothing
-- else, so every customer-side operation goes through a SECURITY DEFINER RPC
-- that takes the token, exactly like submit_public_quote_response — the table
-- itself is readable only by shop members through RLS.

create table public.quote_messages (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  -- Who typed it. Not a role and not a user id: the customer has no account,
  -- and 'shop' has to keep meaning "the shop" after the staff member who
  -- wrote it leaves.
  sender text not null check (sender in ('customer', 'shop')),
  body text not null check (length(btrim(body)) > 0 and length(body) <= 2000),
  -- The staff member, when a shop member wrote it. Null for customer messages
  -- and for anything written before this column meant anything.
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- When the OTHER side saw it. A customer message is read when staff open
  -- the quote; a shop message is read when the customer loads their page.
  read_at timestamptz
);

comment on table public.quote_messages is
  'Two-way thread between a shop and a customer, anchored to one quote. Customers reach it only through the public-token RPCs below.';

create index quote_messages_quote_idx on public.quote_messages (quote_id, created_at);

-- The unread badge asks "does this quote have customer messages nobody has
-- read?" on every quote in the list, so it gets its own partial index.
create index quote_messages_unread_idx on public.quote_messages (quote_id)
  where sender = 'customer' and read_at is null;

alter table public.quote_messages enable row level security;

-- Scoped through the owning quote's shop, same shape as quote_options.
-- Deliberately no anon policy: the customer's access is the RPCs, which run
-- as definer and check the token themselves.
create policy quote_messages_all on public.quote_messages
  for all to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id and public.is_shop_member(q.shop_id)))
  with check (exists (select 1 from public.quotes q where q.id = quote_id and public.is_shop_member(q.shop_id)));

-- ---------------------------------------------------------------------------
-- get_public_quote_thread: the conversation as the customer sees it.
--
-- Marks the shop's messages read on the way out. That read receipt is the
-- whole reason this is a function rather than a view: it is the only signal
-- the shop gets that their answer landed, and there is no tracking pixel
-- anywhere in this product to fake one with.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_quote_thread(p_public_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote_id uuid;
  v_result jsonb;
begin
  select id into v_quote_id from quotes where public_token = p_public_token and status <> 'draft';
  if not found then
    return '[]'::jsonb;
  end if;

  update quote_messages
     set read_at = now()
   where quote_id = v_quote_id and sender = 'shop' and read_at is null;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', m.id,
             'sender', m.sender,
             'body', m.body,
             'createdAt', m.created_at,
             'readAt', m.read_at
           ) order by m.created_at
         ), '[]'::jsonb)
    into v_result
    from quote_messages m
   where m.quote_id = v_quote_id;

  return v_result;
end;
$$;

grant execute on function public.get_public_quote_thread to anon, authenticated;

-- ---------------------------------------------------------------------------
-- post_public_quote_message: the customer says something.
--
-- Rate limited the same way submit_public_quote_response is. The token is in
-- an email that can be forwarded, so the limit is the only thing standing
-- between a bored recipient and a shop owner's notification inbox.
-- ---------------------------------------------------------------------------
create or replace function public.post_public_quote_message(p_public_token uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes%rowtype;
  v_body text;
  v_recent integer;
  v_id uuid;
  v_created timestamptz;
begin
  select * into v_quote from quotes where public_token = p_public_token and status <> 'draft';
  if not found then
    raise exception 'Quote not found';
  end if;

  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then
    raise exception 'Message is empty';
  end if;
  -- Truncate rather than reject: someone who typed a long message on a phone
  -- should not lose it to a validation error they cannot see the edge of.
  v_body := left(v_body, 2000);

  select count(*) into v_recent
    from quote_messages
   where quote_id = v_quote.id and sender = 'customer' and created_at > now() - interval '1 hour';
  if v_recent >= 20 then
    raise exception 'Too many messages — please call the shop';
  end if;

  insert into quote_messages (quote_id, sender, body)
  values (v_quote.id, 'customer', v_body)
  returning id, created_at into v_id, v_created;

  -- The activity feed is where staff look for "what happened on this quote",
  -- so a message has to appear there too, not only in the thread.
  insert into quote_events (quote_id, event_type, metadata)
  values (v_quote.id, 'customer_message', jsonb_build_object('preview', left(v_body, 140)));

  return jsonb_build_object('id', v_id, 'sender', 'customer', 'body', v_body, 'createdAt', v_created, 'readAt', null);
end;
$$;

grant execute on function public.post_public_quote_message to anon, authenticated;

notify pgrst, 'reload schema';
