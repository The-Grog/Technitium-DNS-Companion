export type AdvancedBlockingPauseTargetStatus =
  | "activation-pending"
  | "active"
  | "resume-pending";

/** Live status is separate from durable ownership; only active is confirmed paused. */
export type AdvancedBlockingPauseTargetHealth =
  | "confirmed-paused"
  | "activation-pending"
  | "resume-pending"
  | "live-drift"
  | "error";

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
  /** True only for a durable pause whose live state is confirmed. */
  paused: boolean;
  confirmedPausedTargetCount: number;
  pendingTargetCount: number;
  targets: AdvancedBlockingPauseTarget[];
}

export interface AdvancedBlockingPauseOperationResult extends AdvancedBlockingPauseStatus {
  requestedMinutes?: number;
}
