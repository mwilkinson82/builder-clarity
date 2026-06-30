-- Project To-Dos need richer assignment and reminder metadata.
-- Delivery workers can use reminder_at/reminder_channel once Lovable applies this migration.

ALTER TABLE public.decisions
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reminder_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_channel text NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'decisions_reminder_channel_check'
      AND conrelid = 'public.decisions'::regclass
  ) THEN
    ALTER TABLE public.decisions
      ADD CONSTRAINT decisions_reminder_channel_check
      CHECK (reminder_channel IN ('none', 'in_app', 'email'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS decisions_project_reminder_idx
  ON public.decisions(project_id, reminder_at)
  WHERE reminder_enabled = true AND reminder_at IS NOT NULL;

COMMENT ON COLUMN public.decisions.owner_user_id IS
  'Optional linked Overwatch user responsible for the to-do.';
COMMENT ON COLUMN public.decisions.owner_email IS
  'Email captured for reminder delivery, including outside owners.';
COMMENT ON COLUMN public.decisions.reminder_at IS
  'When a future reminder worker should notify the owner.';
COMMENT ON COLUMN public.decisions.reminder_channel IS
  'Preferred reminder channel: none, in_app, or email.';
