-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('pending_approval', 'info_requested', 'in_fulfillment', 'fulfilled', 'rejected', 'canceled');

-- CreateEnum
CREATE TYPE "ApprovalStepMode" AS ENUM ('single', 'all', 'any', 'sequential');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'canceled');

-- CreateEnum
CREATE TYPE "DecisionValue" AS ENUM ('approved', 'rejected', 'info_requested');

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "eligibility" JSONB,
    "formSchema" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRequestCounter" (
    "key" TEXT NOT NULL DEFAULT 'SR',
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ServiceRequestCounter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'pending_approval',
    "answers" JSONB NOT NULL,
    "infoRequests" JSONB,
    "rejectionReason" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "fulfillNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvalRequestId" TEXT,

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "steps" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL DEFAULT 'service_request',
    "targetId" TEXT NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'pending',
    "steps" JSONB NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "requestedById" TEXT NOT NULL,
    "delegations" JSONB,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" "DecisionValue" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogItem_active_sortOrder_idx" ON "CatalogItem"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRequest_number_key" ON "ServiceRequest"("number");

-- CreateIndex
CREATE INDEX "ServiceRequest_status_idx" ON "ServiceRequest"("status");

-- CreateIndex
CREATE INDEX "ServiceRequest_requesterId_createdAt_idx" ON "ServiceRequest"("requesterId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRule_catalogItemId_key" ON "ApprovalRule"("catalogItemId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_targetType_targetId_idx" ON "ApprovalRequest"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_idx" ON "ApprovalRequest"("status");

-- CreateIndex
CREATE INDEX "ApprovalDecision_approverId_idx" ON "ApprovalDecision"("approverId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalDecision_requestId_stepIndex_approverId_key" ON "ApprovalDecision"("requestId", "stepIndex", "approverId");

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
