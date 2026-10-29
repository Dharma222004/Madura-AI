-- ==============================================================================
-- Migration: 20261026000000_create_memory_and_chat_schema.sql
-- Madura AI — Production-Ready Persistent AI Memory & Chat Schema using Supabase
-- ==============================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Conversations Table
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New Conversation',
    model TEXT DEFAULT 'openai/gpt-oss-20b',
    pinned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Messages Table
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    thought TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. User Memories Table (Long-Term Episodic & Semantic Facts)
CREATE TABLE IF NOT EXISTS public.user_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    memory_type TEXT NOT NULL CHECK (
        memory_type IN ('profile', 'preference', 'project', 'goal', 'decision', 'event', 'instruction')
    ),
    content TEXT NOT NULL,
    embedding vector(2048),
    source_conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
    importance SMALLINT DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

-- 5. Conversation Chunks Table (Semantic Context Windows for Past Conversations)
CREATE TABLE IF NOT EXISTS public.conversation_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding vector(2048),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- Indexes for High Performance & Scalability
-- ==============================================================================

-- B-Tree indexes on user_id & foreign keys
CREATE INDEX IF NOT EXISTS idx_conversations_user ON public.conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_user ON public.messages(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_user_type ON public.user_memories(user_id, memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_user_accessed ON public.user_memories(user_id, last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_user_conv ON public.conversation_chunks(user_id, conversation_id);

-- Full-Text Search (GIN) on content for keyword retrieval
CREATE INDEX IF NOT EXISTS idx_memories_fts ON public.user_memories USING GIN (to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS idx_chunks_fts ON public.conversation_chunks USING GIN (to_tsvector('english', content));

-- pgvector Cosine Distance Indexes (HNSW for high-speed approximate nearest neighbor search)
CREATE INDEX IF NOT EXISTS idx_memories_vector ON public.user_memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_vector ON public.conversation_chunks USING hnsw (embedding vector_cosine_ops);

-- ==============================================================================
-- Row Level Security (RLS) Policies — Total User Data Isolation
-- ==============================================================================

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_chunks ENABLE ROW LEVEL SECURITY;

-- Conversations RLS
CREATE POLICY "Users can manage own conversations"
    ON public.conversations
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Messages RLS
CREATE POLICY "Users can manage own messages"
    ON public.messages
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- User Memories RLS
CREATE POLICY "Users can manage own memories"
    ON public.user_memories
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Conversation Chunks RLS
CREATE POLICY "Users can manage own chunks"
    ON public.conversation_chunks
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ==============================================================================
-- Vector Similarity Search RPC Functions
-- ==============================================================================

-- 1. Match User Memories
CREATE OR REPLACE FUNCTION match_user_memories (
    query_embedding vector(2048),
    match_threshold float,
    match_count int,
    p_user_id uuid
)
RETURNS TABLE (
    id uuid,
    user_id uuid,
    memory_type text,
    content text,
    importance smallint,
    similarity float,
    created_at timestamptz,
    last_accessed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        um.id,
        um.user_id,
        um.memory_type,
        um.content,
        um.importance,
        (1 - (um.embedding <=> query_embedding))::float AS similarity,
        um.created_at,
        um.last_accessed_at
    FROM public.user_memories um
    WHERE um.user_id = p_user_id
      AND um.embedding IS NOT NULL
      AND (1 - (um.embedding <=> query_embedding)) >= match_threshold
    ORDER BY similarity DESC, um.importance DESC
    LIMIT match_count;
END;
$$;

-- 2. Match Conversation Chunks (Past Conversations)
CREATE OR REPLACE FUNCTION match_conversation_chunks (
    query_embedding vector(2048),
    match_threshold float,
    match_count int,
    p_user_id uuid
)
RETURNS TABLE (
    id uuid,
    conversation_id uuid,
    content text,
    similarity float,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        cc.id,
        cc.conversation_id,
        cc.content,
        (1 - (cc.embedding <=> query_embedding))::float AS similarity,
        cc.created_at
    FROM public.conversation_chunks cc
    WHERE cc.user_id = p_user_id
      AND cc.embedding IS NOT NULL
      AND (1 - (cc.embedding <=> query_embedding)) >= match_threshold
    ORDER BY similarity DESC
    LIMIT match_count;
END;
$$;
