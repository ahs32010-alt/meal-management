-- Adds suppress_if_meal_id to beneficiary_fixed_meals.
-- When set, the fixed item is skipped if the specified meal is present in that day's order.
-- Run once in Supabase SQL Editor.

ALTER TABLE beneficiary_fixed_meals
  ADD COLUMN IF NOT EXISTS suppress_if_meal_id uuid REFERENCES meals(id) ON DELETE SET NULL;
