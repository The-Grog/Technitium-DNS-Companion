export type AdvancedBlockingPauseTargetStatus =
  | "pause-pending"
  | "active"
  | "resume-pending";

export interface AdvancedBlockingPauseTarget {
  writeTargetNodeId: string;
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
