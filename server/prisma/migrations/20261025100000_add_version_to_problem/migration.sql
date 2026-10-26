-- Add version column to Problem table for optimistic locking
ALTER TABLE "test"."Problem" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;