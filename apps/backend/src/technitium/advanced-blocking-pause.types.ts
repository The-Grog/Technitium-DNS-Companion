export type AdvancedBlockingPauseTargetStatus =
  "activation-pending" | "active" | "resume-pending";

export interface AdvancedBlockingPauseTarget {
  /** Stable cluster/group ownership key, not a transient Primary node ID. */
  writeTargetNodeId: string;
  anchorNodeId: string;
  lastResolvedNodeId?: string;
  status: AdvancedBlockingPauseTargetStatus;
  expiresAt: string;
  previousEnableBlockingPresent?: boolean;
  previousEnableBlockingValue?: boolean;
  lastError?: string;
  updatedAt: string;
}

export interface AdvancedBlockingPauseStatus {
  paused: boolean;
  targets: AdvancedBlockingPauseTarget[];
}

export interface AdvancedBlockingPauseOperationResult extends AdvancedBlockingPauseStatus {
  requestedMinutes?: number;
}
