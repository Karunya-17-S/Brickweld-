-- 0006: user creation fix
-- New logins get their name AND phone copied into profiles when the account is created.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles(id, full_name, email, phone)
  VALUES (NEW.id,
          coalesce(nullif(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
          NEW.email,
          nullif(NEW.raw_user_meta_data->>'phone', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated, anon, public;

-- Server-side (service role) keeps full access; RLS still protects app users.
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
