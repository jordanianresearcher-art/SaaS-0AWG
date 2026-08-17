-- 0018: a Storage bucket for shop logos.
--
-- Until now shops.logo_url could only hold a link the owner hosted somewhere
-- else. A real shop owner has a logo *file* on their phone or laptop, not a
-- public URL, so onboarding effectively shipped without a logo. This adds a
-- bucket they can upload straight into.
--
-- Why a public bucket: the logo is rendered inside quote emails. Email clients
-- fetch images anonymously with no session and no cookies, and Gmail strips
-- data: URIs — so a signed or private URL cannot work here. A logo is public
-- branding by definition; nothing sensitive lives in this bucket.
--
-- Path convention: <auth.uid()>/<filename>. Keying on the *user* rather than
-- the shop matters because onboarding uploads the logo before the shop row
-- exists — there is no shop id to scope to yet.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shop-logos',
  'shop-logos',
  true,
  2097152, -- 2MB; the client downscales to ~512px before upload anyway
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone may read: this is what makes <img src> work in an emailed quote.
drop policy if exists shop_logos_public_read on storage.objects;
create policy shop_logos_public_read on storage.objects
  for select
  to public
  using (bucket_id = 'shop-logos');

-- Writes are confined to the caller's own folder, so one shop owner can never
-- overwrite or delete another's logo.
drop policy if exists shop_logos_owner_insert on storage.objects;
create policy shop_logos_owner_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'shop-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists shop_logos_owner_update on storage.objects;
create policy shop_logos_owner_update on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'shop-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'shop-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists shop_logos_owner_delete on storage.objects;
create policy shop_logos_owner_delete on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'shop-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
