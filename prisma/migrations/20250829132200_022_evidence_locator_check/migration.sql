-- DHB-58: every evidence row has a locator. The write path resolves
-- blockId/page/version against real structure; this CHECK only rejects
-- a missing or empty locator so existing {"page": 1} fixtures still load.
ALTER TABLE "evidence"
    ADD CONSTRAINT "chk_evidence_locator_object" CHECK (
        jsonb_typeof("locator") = 'object' AND "locator" <> '{}'::jsonb
    );
