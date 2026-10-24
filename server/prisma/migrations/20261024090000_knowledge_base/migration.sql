-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('draft', 'in_review', 'published', 'archived');

-- CreateEnum
CREATE TYPE "KnowledgeVisibility" AS ENUM ('public', 'internal', 'restricted');

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "knowledge" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "KnowledgeStatus" NOT NULL DEFAULT 'draft',
    "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'internal',
    "allowedRoles" "Role"[] DEFAULT ARRAY[]::"Role"[],
    "authorId" TEXT NOT NULL,
    "ownerId" TEXT,
    "sourceTicketId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "reviewIntervalDays" INTEGER NOT NULL DEFAULT 90,
    "reviewDueAt" TIMESTAMP(3),
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "notHelpfulCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeRevision" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visibility" "KnowledgeVisibility" NOT NULL,
    "allowedRoles" "Role"[] DEFAULT ARRAY[]::"Role"[],
    "changeNote" TEXT,
    "editorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeFeedback" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeArticle_status_visibility_idx" ON "KnowledgeArticle"("status", "visibility");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_category_status_idx" ON "KnowledgeArticle"("category", "status");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_authorId_idx" ON "KnowledgeArticle"("authorId");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_ownerId_idx" ON "KnowledgeArticle"("ownerId");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_sourceTicketId_idx" ON "KnowledgeArticle"("sourceTicketId");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_reviewDueAt_idx" ON "KnowledgeArticle"("reviewDueAt");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_updatedAt_idx" ON "KnowledgeArticle"("updatedAt" DESC);

-- CreateIndex
CREATE INDEX "KnowledgeRevision_articleId_createdAt_idx" ON "KnowledgeRevision"("articleId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRevision_articleId_revisionNumber_key" ON "KnowledgeRevision"("articleId", "revisionNumber");

-- CreateIndex
CREATE INDEX "KnowledgeFeedback_articleId_helpful_idx" ON "KnowledgeFeedback"("articleId", "helpful");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeFeedback_articleId_userId_key" ON "KnowledgeFeedback"("articleId", "userId");

-- CreateIndex
CREATE INDEX "ApprovalDecision_requestId_stepIndex_approverId_idx" ON "ApprovalDecision"("requestId", "stepIndex", "approverId");

-- AddForeignKey
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_sourceTicketId_fkey" FOREIGN KEY ("sourceTicketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRevision" ADD CONSTRAINT "KnowledgeRevision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRevision" ADD CONSTRAINT "KnowledgeRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeFeedback" ADD CONSTRAINT "KnowledgeFeedback_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeFeedback" ADD CONSTRAINT "KnowledgeFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
