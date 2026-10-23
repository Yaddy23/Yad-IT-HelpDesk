-- One TERMINAL decision (approved/rejected) per (request, step, approver).
-- info_requested rows are exempt: the approver who asks for information must
-- be able to decide again once the requester responds, and the info rounds
-- stay in history.
DROP INDEX "ApprovalDecision_requestId_stepIndex_approverId_key";
CREATE UNIQUE INDEX "ApprovalDecision_requestId_stepIndex_approverId_key"
  ON "ApprovalDecision"("requestId", "stepIndex", "approverId")
  WHERE "decision" <> 'info_requested';
