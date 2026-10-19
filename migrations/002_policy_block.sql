-- Room gender (mixed/female/male) so policy rules can target "mixed dorms".
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS gender text NOT NULL DEFAULT 'mixed' CHECK (gender IN ('mixed','female','male'));
-- Policy rules may now hard-block a booking request.
ALTER TABLE policy_rules DROP CONSTRAINT IF EXISTS policy_rules_action_check;
ALTER TABLE policy_rules ADD CONSTRAINT policy_rules_action_check CHECK (action IN ('ask','review','require_approval','inform','block'));
