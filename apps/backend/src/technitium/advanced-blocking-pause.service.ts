import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { AdvancedBlockingPauseStateService } from "./advanced-blocking-pause-state.service";
import type {
  AdvancedBlockingPauseOperationResult,
  AdvancedBlockingPauseStatus,
} from "./advanced-blocking-pause.types";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import { DnsSchedulesEvaluatorService } from "./dns-schedules-evaluator.service";
import { TechnitiumService } from "./technitium.service";

@Injectable()
export class AdvancedBlockingPauseService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AdvancedBlockingPauseService.name);
  private timer: NodeJS.Timeout | undefined;
  private reconciling: Promise<void> | undefined;

  constructor(
    private readonly pauseState: AdvancedBlockingPauseStateService,
    private readonly advancedBlockingService: AdvancedBlockingService,
    private readonly schedulesEvaluator: DnsSchedulesEvaluatorService,
    private readonly technitiumService: TechnitiumService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.reconcileExpired(), 15_000);
    void this.reconcileExpired();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  getStatus(): AdvancedBlockingPauseStatus {
    const targets = this.pauseState.list();
    return {
      paused: targets.some((target) => target.status !== "pause-pending"),
      targets,
    };
  }

  async pause(minutes: number): Promise<AdvancedBlockingPauseOperationResult> {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      throw new BadRequestException(
        "minutes must be an integer from 1 through 240.",
      );
    }

    const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
    const summaries = await this.technitiumService.listNodes({
      authMode: "schedule",
    });
    const { writeTargets } =
      await this.technitiumService.resolveClusterWriteTargets(
        summaries.map((node) => node.id),
        summaries,
      );

    for (const nodeId of writeTargets) {
      this.pauseState.beginPause(nodeId, expiresAt);
      try {
        await this.advancedBlockingService.activatePauseRoot(
          nodeId,
          "schedule",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.pauseState.markPausePendingError(nodeId, message);
        this.logger.warn(
          `Failed to pause Advanced Blocking on "${nodeId}": ${message}`,
        );
      }
    }

    return { ...this.getStatus(), requestedMinutes: minutes };
  }

  async resumeNow(): Promise<AdvancedBlockingPauseOperationResult> {
    for (const target of this.pauseState.list()) {
      try {
        await this.resumeTarget(target.writeTargetNodeId);
      } catch (error) {
        this.logger.warn(
          `Failed to resume Advanced Blocking on "${target.writeTargetNodeId}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return this.getStatus();
  }

  private async reconcileExpired(): Promise<void> {
    if (this.reconciling) return this.reconciling;
    this.reconciling = (async () => {
      const now = Date.now();
      for (const target of this.pauseState.list()) {
        if (Date.parse(target.expiresAt) > now) continue;
        try {
          await this.resumeTarget(target.writeTargetNodeId);
        } catch (error) {
          this.logger.warn(
            `Failed to automatically resume Advanced Blocking on "${target.writeTargetNodeId}": ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    })().finally(() => {
      this.reconciling = undefined;
    });
    return this.reconciling;
  }

  private async resumeTarget(writeTargetNodeId: string): Promise<void> {
    const target = this.pauseState.get(writeTargetNodeId);
    if (!target) return;
    if (target.status === "pause-pending") {
      // No successful root write was recorded, so deleting the retry marker
      // cannot re-enable a configuration we do not own.
      this.pauseState.remove(writeTargetNodeId);
      return;
    }
    if (target.previousEnableBlockingPresent === undefined) {
      const message =
        "Pause state is missing the previous root enableBlocking value.";
      this.pauseState.markResumePending(writeTargetNodeId, message);
      throw new Error(message);
    }

    try {
      // Reconcile schedules before restoring the root flag. This is important
      // after an offline expiry: schedule boundaries may have passed while the
      // app was down, but schedules intentionally keep editing lists while
      // root blocking is paused.
      await this.schedulesEvaluator.runNow(false);
      await this.advancedBlockingService.restorePauseRoot(
        writeTargetNodeId,
        target.previousEnableBlockingPresent
          ? target.previousEnableBlockingValue
          : undefined,
        "schedule",
      );
      this.pauseState.remove(writeTargetNodeId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pauseState.markResumePending(writeTargetNodeId, message);
      throw error;
    }
  }
}
