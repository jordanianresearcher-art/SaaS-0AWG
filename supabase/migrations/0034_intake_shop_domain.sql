-- ---------------------------------------------------------------------------
-- 0034 — the counter shortcut learns the shop's own web address.
--
-- The no-login shortcut at /ask/:token builds the review link it texts from
-- the address it was itself opened on. That was fine until the shop got its
-- own domain: the shortcut already saved to the shop phone's home screen
-- still points at the platform address, so every link texted from it read
-- "saas-0awg" to the customer — a stranger's domain arriving by text, minutes
-- after they handed over a card.
--
-- Re-adding the shortcut fixes it, but only if someone remembers to. Handing
-- the shop's domain back with the branding means the page builds the right
-- link whichever door it was opened through, and the old shortcut heals
-- itself the next time it is used.
--
-- custom_domain is not a secret. It is the address printed on every quote and
-- every email the shop sends; this exposes nothing the customer will not read
-- one screen later. The token still buys exactly one capability, and this
-- function still returns nothing about the shop's customers.
--
-- Replaces the function from 0031. Nothing else changes, so this is safe to
-- re-run and safe to apply out of order with 0033.
-- ---------------------------------------------------------------------------
create or replace function public.get_review_intake_shop(p_intake_token uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'shopName', s.name,
    'shopLogoUrl', s.logo_url,
    'shopPrimaryColor', s.primary_color,
    'customDomain', s.custom_domain
  )
  from shops s
  where s.review_intake_token = p_intake_token and s.active;
$$;
grant execute on function public.get_review_intake_shop to anon, authenticated;
