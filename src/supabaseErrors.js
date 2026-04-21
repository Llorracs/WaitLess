-- ============================================================================
-- STEP 4 — LOCK IN owner_id AS NOT NULL
-- ============================================================================
-- CRITICAL: Only run this AFTER:
--   1. Step 1 audit shows zero venues with NULL owner_id
--   2. Step 2 trigger is in place
--
-- If any venue still has NULL owner_id when this runs, it will FAIL with:
--   "ERROR: column contains null values"
-- That's a SAFE failure — nothing breaks, you just go back and fix the NULL.
--
-- This is the fix that makes it impossible for a venue to ever again have
-- its owner_id accidentally blanked out. Supabase will reject any attempt.
-- ============================================================================

ALTER TABLE venues
  ALTER COLUMN owner_id SET NOT NULL;

-- Confirmation query — run this after to verify
SELECT
  column_name,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_name = 'venues' AND column_name = 'owner_id';
