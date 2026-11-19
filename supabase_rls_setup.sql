-- Tourx Supabase Schema Columns & Row-Level Security (RLS) Setup
-- Run this once in Supabase Dashboard -> SQL Editor to enable full cross-user
-- bookings, availability calendar locking, host QR codes, and portal switching
-- on both full-stack and static Netlify deployments.

-- 1. Ensure QR image columns exist
ALTER TABLE IF EXISTS public.user_private_info
  ADD COLUMN IF NOT EXISTS payment_qr_url TEXT DEFAULT '';

ALTER TABLE IF EXISTS public.listing_payment_destinations
  ADD COLUMN IF NOT EXISTS payment_qr_url TEXT DEFAULT '';

-- 2. Enable RLS on all tables
ALTER TABLE IF EXISTS public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_private_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.listing_payment_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.availability_slots ENABLE ROW LEVEL SECURITY;

-- 3. user_profiles policies (members can read/insert/update their own profile)
DROP POLICY IF EXISTS "Users can read own profile" ON public.user_profiles;
CREATE POLICY "Users can read own profile"
  ON public.user_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = uid);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
CREATE POLICY "Users can insert own profile"
  ON public.user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = uid);

DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users can update own profile"
  ON public.user_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = uid)
  WITH CHECK (auth.uid() = uid);

-- 4. user_private_info policies (strictly owner-only)
DROP POLICY IF EXISTS "Users can read own private info" ON public.user_private_info;
CREATE POLICY "Users can read own private info"
  ON public.user_private_info FOR SELECT
  TO authenticated
  USING (auth.uid() = uid);

DROP POLICY IF EXISTS "Users can insert own private info" ON public.user_private_info;
CREATE POLICY "Users can insert own private info"
  ON public.user_private_info FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = uid);

DROP POLICY IF EXISTS "Users can update own private info" ON public.user_private_info;
CREATE POLICY "Users can update own private info"
  ON public.user_private_info FOR UPDATE
  TO authenticated
  USING (auth.uid() = uid)
  WITH CHECK (auth.uid() = uid);

-- 5. listings policies (authenticated users can view published listings or own listings; hosts manage own)
DROP POLICY IF EXISTS "Authenticated users can view published or own listings" ON public.listings;
CREATE POLICY "Authenticated users can view published or own listings"
  ON public.listings FOR SELECT
  TO authenticated
  USING (is_published = true OR auth.uid() = host_id);

DROP POLICY IF EXISTS "Hosts can insert own listings" ON public.listings;
CREATE POLICY "Hosts can insert own listings"
  ON public.listings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = host_id);

DROP POLICY IF EXISTS "Hosts can update own listings" ON public.listings;
CREATE POLICY "Hosts can update own listings"
  ON public.listings FOR UPDATE
  TO authenticated
  USING (auth.uid() = host_id)
  WITH CHECK (auth.uid() = host_id);

DROP POLICY IF EXISTS "Hosts can delete own listings" ON public.listings;
CREATE POLICY "Hosts can delete own listings"
  ON public.listings FOR DELETE
  TO authenticated
  USING (auth.uid() = host_id);

-- 6. listing_payment_destinations policies (authenticated travellers can view listing payment destination; hosts manage own)
DROP POLICY IF EXISTS "Authenticated users can read listing payment destinations" ON public.listing_payment_destinations;
CREATE POLICY "Authenticated users can read listing payment destinations"
  ON public.listing_payment_destinations FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Hosts can insert own payment destinations" ON public.listing_payment_destinations;
CREATE POLICY "Hosts can insert own payment destinations"
  ON public.listing_payment_destinations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = host_id);

DROP POLICY IF EXISTS "Hosts can update own payment destinations" ON public.listing_payment_destinations;
CREATE POLICY "Hosts can update own payment destinations"
  ON public.listing_payment_destinations FOR UPDATE
  TO authenticated
  USING (auth.uid() = host_id)
  WITH CHECK (auth.uid() = host_id);

DROP POLICY IF EXISTS "Hosts can delete own payment destinations" ON public.listing_payment_destinations;
CREATE POLICY "Hosts can delete own payment destinations"
  ON public.listing_payment_destinations FOR DELETE
  TO authenticated
  USING (auth.uid() = host_id);

-- 7. bookings policies (travellers and hosts can read own; travellers can create; both can update status)
DROP POLICY IF EXISTS "Travellers and hosts can read own bookings" ON public.bookings;
CREATE POLICY "Travellers and hosts can read own bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (auth.uid() = traveller_id OR auth.uid() = host_id);

DROP POLICY IF EXISTS "Travellers can create own bookings" ON public.bookings;
CREATE POLICY "Travellers can create own bookings"
  ON public.bookings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = traveller_id);

DROP POLICY IF EXISTS "Travellers and hosts can update own bookings" ON public.bookings;
CREATE POLICY "Travellers and hosts can update own bookings"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (auth.uid() = traveller_id OR auth.uid() = host_id)
  WITH CHECK (auth.uid() = traveller_id OR auth.uid() = host_id);

-- 8. availability_slots policies (authenticated users can view active slots; travellers/hosts can create & cancel)
DROP POLICY IF EXISTS "Authenticated users can read active availability" ON public.availability_slots;
CREATE POLICY "Authenticated users can read active availability"
  ON public.availability_slots FOR SELECT
  TO authenticated
  USING (status = 'active' OR auth.uid() = traveller_id OR auth.uid() = host_id);

DROP POLICY IF EXISTS "Travellers can reserve availability slots" ON public.availability_slots;
CREATE POLICY "Travellers can reserve availability slots"
  ON public.availability_slots FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = traveller_id);

DROP POLICY IF EXISTS "Travellers and hosts can update availability slots" ON public.availability_slots;
CREATE POLICY "Travellers and hosts can update availability slots"
  ON public.availability_slots FOR UPDATE
  TO authenticated
  USING (auth.uid() = traveller_id OR auth.uid() = host_id)
  WITH CHECK (auth.uid() = traveller_id OR auth.uid() = host_id);
