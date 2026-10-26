-- Add version column to Problem table for optimistic locking
-- Schema-unqualified (like every other migration) so it applies to whatever
-- schema the connection's search_path points at.
ALTER TABLE "Problem" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
