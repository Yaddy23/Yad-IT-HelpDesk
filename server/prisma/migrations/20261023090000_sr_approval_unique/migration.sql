-- One approval per service request: a duplicated approval link (retry, racing
-- submit) is impossible at the DB level.
CREATE UNIQUE INDEX "ServiceRequest_approvalRequestId_key" ON "ServiceRequest"("approvalRequestId");
