-- Timestamps on ApprovalRequest — needed for queue ordering and history display.
ALTER TABLE "ApprovalRequest" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ApprovalRequest" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL;
