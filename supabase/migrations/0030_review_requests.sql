-- 0030: ask a paying customer for a review, and watch what they do with it.
--
-- The shop's real workflow, unchanged: a phone number goes on a slip of paper
-- at the counter when someone pays. This replaces the slip. Staff type the
-- number, the app writes the text, and the staff member's own phone sends it —
-- the same tap-to-text stance as every other message here, for the same
-- reasons (no A2P 10DLC registration, and a text from the number the customer
-- recognizes lands better than one from a shortcode).
--
-- ON THE GATE. Sending five-star customers to a public review site while
-- diverting everyone else to a private form is "review gating". Google's
-- review policies prohibit it and a listing caught doing it can have its
-- reviews stripped or be suspended. The shop asked for it and it is their
-- listing, so it ships — but as `shops.review_gate_enabled`, which they can
-- turn off to show the public link to everyone and still collect the written
-- feedback. The risk is a business decision, not a property of the schema.
--
-- The customer never authenticates. They follow a texted link carrying an
-- unguessable token, so every customer-side operation is a SECURITY DEFINER
-- RPC keyed on that token, exactly like the public quote page.

alter table public.shops
  add column review_link text,
  add column review_gate_enabled boolean not null default true;

comment on column public.shops.review_link is
  'Where a happy customer is sent to leave a public review. Null means the landing page collects feedback from everyone and redirects nobody.';
comment on column public.shops.review_gate_enabled is
  'True routes only top ratings to review_link (review gating — against Google policy; see 0030 header). False shows the link to every rating.';

create table public.review_requests (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  -- What the texted link carries. Unguessable, and the only thing the
  -- customer ever presents.
  public_token uuid not null unique default gen_random_uuid(),
  -- Digits as normalized by src/lib/sms.ts. Free text on purpose: staff are
  -- copying a slip of paper mid-conversation and this app has no required
  -- fields anywhere.
  phone text not null,
  customer_name text,
  -- Optional links back to the rest of the app, for a request raised off an
  -- existing customer or the invoice they just paid.
  customer_id uuid references public.customers(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Stamped when staff tap the text link. Not proof of delivery: the message
  -- is handed to the staff member's own SMS app and this app never learns
  -- whether they pressed send. Named for what it actually means.
  handed_to_phone_at timestamptz,
  first_opened_at timestamptz,
  open_count integer not null default 0,
  -- The FIRST rating, kept immutable. A customer who rates two and comes back
  -- to tap five has told the shop something, and overwriting it would erase
  -- exactly the fact worth knowing.
  rating smallint check (rating is null or rating between 1 and 5),
  rated_at timestamptz,
  last_rating smallint check (last_rating is null or last_rating between 1 and 5),
  rating_attempts integer not null default 0,
  feedback text,
  feedback_at timestamptz,
  -- The permanent cancel. Once true it is never set back to false by any code
  -- path in this migration; that is the shop's explicit requirement.
  redirect_blocked boolean not null default false,
  redirected_at timestamptz
);

comment on table public.review_requests is
  'One texted review ask. Customers reach it only through the public-token RPCs below; the table itself is shop-members-only.';

create index review_requests_shop_idx on public.review_requests (shop_id, created_at desc);

alter table public.review_requests enable row level security;

create policy review_requests_all on public.review_requests
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

-- ---------------------------------------------------------------------------
-- get_public_review_request: what the landing page shows, and the record that
-- they opened it.
--
-- Stamping the open here is the whole "who clicked the link" answer, and it is
-- honest in a way an email open never is: the customer loaded a page.
--
-- Never returns review_link to a blocked request. The gate has to hold in the
-- payload, not only in the UI — anyone can read what the page was handed.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_review_request(p_public_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req review_requests%rowtype;
  v_shop shops%rowtype;
begin
  select * into v_req from review_requests where public_token = p_public_token;
  if not found then
    return null;
  end if;
  select * into v_shop from shops where id = v_req.shop_id;
  if not found or not v_shop.active then
    return null;
  end if;

  update review_requests
     set first_opened_at = coalesce(first_opened_at, now()),
         open_count = open_count + 1
   where id = v_req.id
  returning * into v_req;

  return jsonb_build_object(
    'shopName', v_shop.name,
    'shopLogoUrl', v_shop.logo_url,
    'shopPrimaryColor', v_shop.primary_color,
    'shopPhone', v_shop.phone,
    'customerName', v_req.customer_name,
    'rating', v_req.rating,
    'lastRating', v_req.last_rating,
    'feedback', v_req.feedback,
    'redirectBlocked', v_req.redirect_blocked,
    'gateEnabled', v_shop.review_gate_enabled,
    -- Withheld entirely once blocked, so the page cannot leak it.
    'reviewLink', case when v_req.redirect_blocked then null else v_shop.review_link end
  );
end;
$$;

grant execute on function public.get_public_review_request to anon, authenticated;

-- ---------------------------------------------------------------------------
-- submit_review_rating: the star tap, and the gate decision.
--
-- The decision is made here rather than in the browser because the browser is
-- the customer's. Mirrors decideReviewGate() in src/lib/reviewRequests.ts;
-- change one, change the other.
-- ---------------------------------------------------------------------------
create or replace function public.submit_review_rating(p_public_token uuid, p_rating smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req review_requests%rowtype;
  v_shop shops%rowtype;
  v_link text;
  v_redirect text;
begin
  select * into v_req from review_requests where public_token = p_public_token;
  if not found then
    raise exception 'Review request not found';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be 1 to 5';
  end if;

  select * into v_shop from shops where id = v_req.shop_id;
  v_link := nullif(btrim(coalesce(v_shop.review_link, '')), '');

  update review_requests
     set rating = coalesce(rating, p_rating),
         rated_at = coalesce(rated_at, now()),
         last_rating = p_rating,
         rating_attempts = rating_attempts + 1,
         -- Sticky: once true it stays true, so a later five-star tap can
         -- never re-open the redirect.
         redirect_blocked = redirect_blocked or (v_shop.review_gate_enabled and p_rating < 5)
   where id = v_req.id
  returning * into v_req;

  if v_req.redirect_blocked then
    v_redirect := null;
  elsif not v_shop.review_gate_enabled then
    v_redirect := v_link;
  elsif p_rating >= 5 then
    v_redirect := v_link;
  else
    v_redirect := null;
  end if;

  if v_redirect is not null then
    update review_requests set redirected_at = coalesce(redirected_at, now()) where id = v_req.id;
  end if;

  return jsonb_build_object(
    'redirectTo', v_redirect,
    'showFeedback', (v_redirect is null or not v_shop.review_gate_enabled),
    'redirectBlocked', v_req.redirect_blocked
  );
end;
$$;

grant execute on function public.submit_review_rating to anon, authenticated;

-- ---------------------------------------------------------------------------
-- submit_review_feedback: what went wrong, in their words.
-- ---------------------------------------------------------------------------
create or replace function public.submit_review_feedback(p_public_token uuid, p_feedback text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text;
begin
  v_body := btrim(coalesce(p_feedback, ''));
  if v_body = '' then
    return;
  end if;
  -- Truncated rather than rejected. Somebody venting on a phone should not
  -- lose it to a limit they cannot see the edge of.
  update review_requests
     set feedback = left(v_body, 4000),
         feedback_at = now()
   where public_token = p_public_token;
end;
$$;

grant execute on function public.submit_review_feedback to anon, authenticated;

notify pgrst, 'reload schema';
