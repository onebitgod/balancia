-- Migration: Create posts table
-- Description: Stores posts for analysis (reference table)
-- Note: This is a reference schema. Your actual posts table might be in a different database.

CREATE TABLE IF NOT EXISTS posts (
    id VARCHAR(50) PRIMARY KEY,
    content TEXT NOT NULL,
    author_id VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Optional metadata fields
    platform VARCHAR(50),
    language VARCHAR(10) DEFAULT 'en',

    -- Indexes for faster queries
    CONSTRAINT content_not_empty CHECK (LENGTH(content) > 0)
);

-- Create indexes
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX idx_posts_author_id ON posts(author_id);
CREATE INDEX idx_posts_platform ON posts(platform);

-- Full-text search index for content (PostgreSQL specific)
CREATE INDEX idx_posts_content_fulltext ON posts USING gin(to_tsvector('english', content));

-- Comments
COMMENT ON TABLE posts IS 'Posts to be analyzed for common phrases and originality';
COMMENT ON COLUMN posts.id IS 'Unique post identifier';
COMMENT ON COLUMN posts.content IS 'The text content of the post';
COMMENT ON COLUMN posts.created_at IS 'When the post was created';
