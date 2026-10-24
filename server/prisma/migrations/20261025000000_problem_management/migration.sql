-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('IDENTIFIED', 'INVESTIGATION', 'ROOT_CAUSE_KNOWN', 'WORKAROUND_DOCUMENTED', 'PENDING_CHANGE', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProblemPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RCAType" AS ENUM ('FIVE_WHYS', 'FISHBONE', 'NONE');

-- CreateEnum
CREATE TYPE "KnownErrorStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "KnownErrorVisibility" AS ENUM ('IT_ONLY', 'EMPLOYEE_SELF_SERVICE');

-- CreateTable
CREATE TABLE "ProblemCounter" (
    "key" TEXT NOT NULL DEFAULT 'PRB',
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProblemCounter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "KnownErrorCounter" (
    "key" TEXT NOT NULL DEFAULT 'KE',
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "KnownErrorCounter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ProblemStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "priority" "ProblemPriority" NOT NULL DEFAULT 'MEDIUM',
    "rcaType" "RCAType" NOT NULL DEFAULT 'NONE',
    "ownerId" TEXT NOT NULL,
    "affectedServices" TEXT[],
    "affectedAssets" TEXT[],
    "affectedCIs" TEXT[],
    "businessImpact" TEXT NOT NULL,
    "rootCause" TEXT,
    "resolutionSummary" TEXT,
    "rcaNotes" TEXT,
    "fiveWhys" JSONB,
    "fishbone" JSONB,
    "confirmedRootCause" BOOLEAN NOT NULL DEFAULT false,
    "workaround" TEXT,
    "knownErrorId" TEXT,
    "changeRequestIds" TEXT[],
    "detectionSource" TEXT,
    "autoDetectionScore" DOUBLE PRECISION,
    "identifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "investigationStartedAt" TIMESTAMP(3),
    "rootCauseIdentifiedAt" TIMESTAMP(3),
    "workaroundDocumentedAt" TIMESTAMP(3),
    "changeInitiatedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reviewDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemIncident" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedById" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "ProblemIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnownError" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "rootCause" TEXT NOT NULL,
    "symptoms" TEXT NOT NULL,
    "workaround" TEXT NOT NULL,
    "resolutionNotes" TEXT,
    "affectedServices" TEXT[],
    "affectedAssets" TEXT[],
    "affectedCIs" TEXT[],
    "status" "KnownErrorStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "KnownErrorVisibility" NOT NULL DEFAULT 'IT_ONLY',
    "ownerId" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reviewDueAt" TIMESTAMP(3),
    "lastReviewedAt" TIMESTAMP(3),
    "publishedArticleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "KnownError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemRCA" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "fiveWhys" JSONB,
    "fishbone" JSONB,
    "attachments" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemRCA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemAuditLog" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectionSuggestion" (
    "id" TEXT NOT NULL,
    "incidentIds" TEXT[],
    "problemId" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "matchReasons" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DetectionSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Problem_number_key" ON "Problem"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_knownErrorId_key" ON "Problem"("knownErrorId");

-- CreateIndex
CREATE INDEX "Problem_status_idx" ON "Problem"("status");

-- CreateIndex
CREATE INDEX "Problem_ownerId_idx" ON "Problem"("ownerId");

-- CreateIndex
CREATE INDEX "Problem_number_idx" ON "Problem"("number");

-- CreateIndex
CREATE INDEX "Problem_identifiedAt_idx" ON "Problem"("identifiedAt");

-- CreateIndex
CREATE INDEX "Problem_affectedServices_affectedAssets_idx" ON "Problem"("affectedServices", "affectedAssets");

-- CreateIndex
CREATE INDEX "ProblemIncident_incidentId_idx" ON "ProblemIncident"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemIncident_problemId_incidentId_key" ON "ProblemIncident"("problemId", "incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "KnownError_number_key" ON "KnownError"("number");

-- CreateIndex
CREATE INDEX "KnownError_status_idx" ON "KnownError"("status");

-- CreateIndex
CREATE INDEX "KnownError_visibility_idx" ON "KnownError"("visibility");

-- CreateIndex
CREATE INDEX "KnownError_problemId_idx" ON "KnownError"("problemId");

-- CreateIndex
CREATE INDEX "KnownError_ownerId_idx" ON "KnownError"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemRCA_problemId_key" ON "ProblemRCA"("problemId");

-- CreateIndex
CREATE INDEX "ProblemRCA_problemId_idx" ON "ProblemRCA"("problemId");

-- CreateIndex
CREATE INDEX "ProblemAuditLog_problemId_idx" ON "ProblemAuditLog"("problemId");

-- CreateIndex
CREATE INDEX "ProblemAuditLog_createdAt_idx" ON "ProblemAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "DetectionSuggestion_status_idx" ON "DetectionSuggestion"("status");

-- CreateIndex
CREATE INDEX "DetectionSuggestion_expiresAt_idx" ON "DetectionSuggestion"("expiresAt");

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_knownErrorId_fkey" FOREIGN KEY ("knownErrorId") REFERENCES "KnownError"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemIncident" ADD CONSTRAINT "ProblemIncident_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemIncident" ADD CONSTRAINT "ProblemIncident_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemIncident" ADD CONSTRAINT "ProblemIncident_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnownError" ADD CONSTRAINT "KnownError_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnownError" ADD CONSTRAINT "KnownError_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnownError" ADD CONSTRAINT "KnownError_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnownError" ADD CONSTRAINT "KnownError_publishedArticleId_fkey" FOREIGN KEY ("publishedArticleId") REFERENCES "KnowledgeArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemRCA" ADD CONSTRAINT "ProblemRCA_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemAuditLog" ADD CONSTRAINT "ProblemAuditLog_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemAuditLog" ADD CONSTRAINT "ProblemAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

