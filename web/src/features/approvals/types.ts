export interface ApprovalsSummary {
  ok: true;
  databaseExists: boolean;
  count: number;
  approvals: PendingActionApproval[];
}

export interface PendingActionApproval {
  id: number;
  channel: string;
  userId?: string;
  category: string;
  action: string;
  target?: string;
  reason?: string;
  proposedReason?: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

export interface ApprovalActionResult extends ApprovalsSummary {
  action: "approve" | "deny";
  approval: PendingActionApproval;
  execution?: {
    ok: boolean;
    message?: string;
    error?: string;
  };
}

export type ApprovalDecision = "approve" | "deny";
