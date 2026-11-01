-- Use Mistral Large 4 for new conversations that omit an explicit model.
-- Preserve model selections on existing conversations.
ALTER TABLE public.conversations
    ALTER COLUMN model SET DEFAULT 'mistralai/mistral-large-4-1t-a52b';
