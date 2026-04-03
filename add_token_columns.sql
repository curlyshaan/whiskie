-- Add token usage columns to ai_decisions table
ALTER TABLE ai_decisions
ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
ADD COLUMN IF NOT EXISTS total_tokens INTEGER,
ADD COLUMN IF NOT EXISTS cost_estimate DECIMAL(10, 4),
ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

-- Verify columns were added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'ai_decisions'
ORDER BY ordinal_position;
