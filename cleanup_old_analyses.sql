-- Delete all old AI decisions (analyses with inaccurate prices)
DELETE FROM ai_decisions;

-- Reset the sequence
ALTER SEQUENCE ai_decisions_id_seq RESTART WITH 1;

-- Confirm deletion
SELECT COUNT(*) as remaining_analyses FROM ai_decisions;
