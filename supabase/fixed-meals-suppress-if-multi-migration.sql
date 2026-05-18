-- Replaces the single suppress_if_meal_id column with a uuid[] array,
-- allowing multiple meals to trigger suppression of a fixed item.
-- Run once in Supabase SQL Editor AFTER fixed-meals-suppress-if-migration.sql.

ALTER TABLE beneficiary_fixed_meals
  DROP COLUMN IF EXISTS suppress_if_meal_id;

ALTER TABLE beneficiary_fixed_meals
  ADD COLUMN IF NOT EXISTS suppress_if_meal_ids uuid[] NOT NULL DEFAULT '{}';
