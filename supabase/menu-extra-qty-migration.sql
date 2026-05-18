-- Add extra_quantity to menu_items so count adjustments in the menu page
-- survive into production orders (same pattern as order_items.extra_quantity).
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS extra_quantity integer NOT NULL DEFAULT 0;
