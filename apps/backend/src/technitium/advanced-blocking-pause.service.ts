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
  AdvancedBlockingPauseTarget,
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
    this.timer = setInterval(() => void this.reconcile(), 15_000);
    void this.reconcile();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  getStatus(): AdvancedBlockingPauseStatus {
    const targets = this.pauseState.list();
    return {
      paused: targets.some(
        (target) =>
          target.status !== "activation-pending" || Boolean(target.lastError),
      ),
      targets,
    };
  }

  async pause(minutes: number): Promise<AdvancedBlockingPauseOperationResult> {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240)
      throw new BadRequestException(
        "minutes must be an integer from 1 through 240.",
      );
    const interactiveNodes = await this.technitiumService.listNodes({
      authMode: "session",
    });
    const eligible = interactiveNodes
      .filter((node) => node.hasAdvancedBlocking === true)
      .map((node) => node.id);
    // Built-in-only nodes deliberately retain their existing browser-local pause path.
    if (eligible.length === 0)
      return { ...this.getStatus(), requestedMinutes: minutes };
    await this.technitiumService.assertSessionConfigWriteAccess(eligible);
    const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
    const targets = new Map<string, { anchorNodeId: string }>();
    for (const nodeId of eligible) {
      const target = await this.advancedBlockingService.resolvePauseTarget(
        nodeId,
        "schedule",
      );
      if (!targets.has(target.targetKey))
        targets.set(target.targetKey, { anchorNodeId: nodeId });
    }
    for (const [targetKey, target] of targets) {
      this.pauseState.beginPause(targetKey, target.anchorNodeId, expiresAt);
      await this.tryActivate(targetKey, target.anchorNodeId);
    }
    return { ...this.getStatus(), requestedMinutes: minutes };
  }

  async resumeNow(): Promise<AdvancedBlockingPauseOperationResult> {
    const targets = this.pauseState.list();
    await this.technitiumService.assertSessionConfigWriteAccess(
      targets.map((target) => target.anchorNodeId),
    );
    for (const target of targets) await this.tryResume(target);
    return this.getStatus();
  }

  private async reconcile(): Promise<void> {
    if (this.reconciling) return this.reconciling;
    this.reconciling = (async () => {
      const now = Date.now();
      for (const rawTarget of this.pauseState.list()) {
        const target = await this.resolveDurableTarget(rawTarget);
        if (!target) continue;
        if (Date.parse(target.expiresAt) <= now) {
          await this.tryResume(target);
        } else if (target.status === "active") {
          await this.verifyActiveTarget(target);
        } else {
          await this.tryActivate(target.writeTargetNodeId, target.anchorNodeId);
        }
      }
    })().finally(() => {
      this.reconciling = undefined;
    });
    return this.reconciling;
  }

  private async resolveDurableTarget(
    target: AdvancedBlockingPauseTarget,
  ): Promise<AdvancedBlockingPauseTarget | undefined> {
    try {
      const resolved = await this.advancedBlockingService.resolvePauseTarget(
        target.anchorNodeId,
        "schedule",
      );
      const legacy =
        !target.writeTargetNodeId.startsWith("node:") &&
        !target.writeTargetNodeId.startsWith("cluster:");
      if (legacy) {
        this.pauseState.migrateLegacyKey(
          target.writeTargetNodeId,
          resolved.targetKey,
        );
        return this.pauseState.get(resolved.targetKey);
      }
      if (resolved.targetKey !== target.writeTargetNodeId) {
        throw new Error(
          "Durable pause ownership key does not match the current validated target.",
        );
      }
      return target;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pauseState.markResumePending(target.writeTargetNodeId, message);
      this.logger.warn(
        `Unable to resolve durable Advanced Blocking pause "${target.writeTargetNodeId}": ${message}`,
      );
      return undefined;
    }
  }
  private async verifyActiveTarget(
    target: AdvancedBlockingPauseTarget,
  ): Promise<void> {
    try {
      const live = await this.advancedBlockingService.verifyPauseRoot(
        target.anchorNodeId,
        "schedule",
      );
      if (live.targetKey !== target.writeTargetNodeId) {
        throw new Error(
          "Durable pause ownership key no longer matches the resolved target.",
        );
      }
      if (live.paused) {
        this.pauseState.markVerified(
          target.writeTargetNodeId,
          live.writeNodeId,
        );
        return;
      }
      // Confirmed drift is the only active-state path that issues config/set.
      await this.tryActivate(target.writeTargetNodeId, target.anchorNodeId);
    } catch (error) {
      // Preserve confirmed ownership/enforcement on transient verification errors.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to verify Advanced Blocking pause for "${target.writeTargetNodeId}": ${message}`,
      );
    }
  }
  private async tryActivate(
    targetKey: string,
    anchorNodeId: string,
  ): Promise<void> {
    try {
      await this.advancedBlockingService.activatePauseRoot(
        anchorNodeId,
        "schedule",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pauseState.markActivationPending(targetKey, message);
      this.logger.warn(
        `Failed to activate Advanced Blocking pause for "${targetKey}": ${message}`,
      );
    }
  }

  private async tryResume(target: AdvancedBlockingPauseTarget): Promise<void> {
    if (target.previousEnableBlockingPresent === undefined) {
      this.pauseState.markResumePending(
        target.writeTargetNodeId,
        "Pause activation was never confirmed; retaining durable state for a safe retry.",
      );
      return;
    }
    try {
      // A normal return is insufficient: pending recovery and any evaluator error
      // mean schedule-owned lists are not known to be reconciled yet.
      const reconciliation = await this.schedulesEvaluator.runNow(false);
      if (
        reconciliation.errored > 0 ||
        reconciliation.pendingRecoveryCount > 0
      ) {
        throw new Error(
          "DNS Schedule reconciliation is incomplete; keeping Advanced Blocking paused.",
        );
      }
      await this.advancedBlockingService.restorePauseRoot(
        target.anchorNodeId,
        target.previousEnableBlockingPresent
          ? target.previousEnableBlockingValue
          : undefined,
        "schedule",
        (resolvedTargetKey) => this.pauseState.remove(resolvedTargetKey),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pauseState.markResumePending(target.writeTargetNodeId, message);
      this.logger.warn(
        `Failed to resume Advanced Blocking for "${target.writeTargetNodeId}": ${message}`,
      );
    }
  }
}
