-- Migration: Create common_phrases table
-- Description: Stores frequently occurring phrases with their frequency, category, and weight

-- Create common_phrases table
CREATE TABLE IF NOT EXISTS common_phrases (
    phrase VARCHAR(100) PRIMARY KEY,
    frequency DECIMAL(6,4) NOT NULL,           -- 0.0523 = 5.23% of posts
    category VARCHAR(50) NOT NULL,             -- greeting, courtesy, reaction, temporal, filler, platform
    weight DECIMAL(3,2) NOT NULL,              -- 0.05 to 1.0 (how much to de-emphasize)
    n_gram_size INTEGER NOT NULL,              -- 1, 2, 3, 4, or 5
    first_seen TIMESTAMP NOT NULL,
    last_updated TIMESTAMP NOT NULL,
    post_count INTEGER NOT NULL,               -- absolute count for reference

    -- Constraints
    CONSTRAINT frequency_range CHECK (frequency >= 0 AND frequency <= 1),
    CONSTRAINT weight_range CHECK (weight >= 0 AND weight <= 1),
    CONSTRAINT n_gram_size_range CHECK (n_gram_size >= 1 AND n_gram_size <= 5)
);

-- Create indexes for faster queries
CREATE INDEX idx_common_phrases_category ON common_phrases(category);
CREATE INDEX idx_common_phrases_frequency ON common_phrases(frequency DESC);
CREATE INDEX idx_common_phrases_n_gram_size ON common_phrases(n_gram_size);
CREATE INDEX idx_common_phrases_last_updated ON common_phrases(last_updated DESC);

-- Create index for phrases by weight (for filtering)
CREATE INDEX idx_common_phrases_weight ON common_phrases(weight);

-- Comments
COMMENT ON TABLE common_phrases IS 'Stores frequently occurring phrases identified by the analytics job';
COMMENT ON COLUMN common_phrases.phrase IS 'The phrase text (normalized to lowercase)';
COMMENT ON COLUMN common_phrases.frequency IS 'Frequency ratio: count / total_posts (0.0 to 1.0)';
COMMENT ON COLUMN common_phrases.category IS 'Phrase category: greeting, courtesy, reaction, temporal, filler, platform, unknown';
COMMENT ON COLUMN common_phrases.weight IS 'Weight for embedding calculation (lower = more common)';
COMMENT ON COLUMN common_phrases.n_gram_size IS 'Number of words in the phrase (1-5)';
COMMENT ON COLUMN common_phrases.post_count IS 'Absolute number of posts containing this phrase';

-- Sample data for testing (optional)
-- Uncomment to insert sample data
/*
INSERT INTO common_phrases (phrase, frequency, category, weight, n_gram_size, first_seen, last_updated, post_count)
VALUES
    ('good morning', 0.1234, 'greeting', 0.1, 2, NOW(), NOW(), 123456),
    ('thank you', 0.0876, 'courtesy', 0.2, 2, NOW(), NOW(), 87654),
    ('lol', 0.1543, 'reaction', 0.05, 1, NOW(), NOW(), 154321),
    ('happy birthday', 0.0456, 'temporal', 0.1, 2, NOW(), NOW(), 45678),
    ('in my opinion', 0.0345, 'filler', 0.5, 3, NOW(), NOW(), 34567),
    ('check out', 0.0678, 'platform', 0.2, 2, NOW(), NOW(), 67890)
ON CONFLICT (phrase) DO NOTHING;
*/
