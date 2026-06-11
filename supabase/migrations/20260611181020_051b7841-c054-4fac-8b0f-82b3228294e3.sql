ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS body_markdown text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS email_recipients text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pdf_style text NOT NULL DEFAULT 'executive',
  ADD COLUMN IF NOT EXISTS kpi_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;