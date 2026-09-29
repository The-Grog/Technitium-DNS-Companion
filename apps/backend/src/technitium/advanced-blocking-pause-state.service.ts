import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { CompanionDbService } from "./companion-db.service";
import type {
  AdvancedBlockingPauseTarget,
  AdvancedBlockingPauseTargetStatus,
} from "./advanced-blocking-pause.types";

type PauseRow = {
  write_target_node_id: string;
  status: AdvancedBlockingPauseTargetStatus;
  expires_at: string;
  previous_enable_blocking_present: number | null;
  previous_enable_blocking_value: number | null;
  last_error: string | null;
  updated_at: string;
};

/** Durable state for Companion-owned root Advanced Blocking pauses. */
@Injectable()
export class AdvancedBlockingPauseStateService implements OnModuleInit {
  private readonly logger = new Logger(AdvancedBlockingPauseStateService.name);

  constructor(private readonly companionDb: CompanionDbService) {}

  onModuleInit(): void {
    const db = this.companionDb.db;
    if (!db) {
      this.logger.error(
        "Advanced Blocking pause state is unavailable because Companion SQLite is unavailable.",
      );
      return;
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS advanced_blocking_pauses (
        write_target_node_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('pause-pending', 'active', 'resume-pending')),
        expires_at TEXT NOT NULL,
        previous_enable_blocking_present INTEGER CHECK (previous_enable_blocking_present IN (0, 1)),
        previous_enable_blocking_value INTEGER CHECK (previous_enable_blocking_value IN (0, 1)),
        last_error TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_advanced_blocking_pauses_expiry
        ON advanced_blocking_pauses(expires_at);
    `);
  }

  list(): AdvancedBlockingPauseTarget[] {
    const db = this.requireDb();
    return (
      db
        .prepare(
          `SELECT * FROM advanced_blocking_pauses ORDER BY write_target_node_id`,
        )
        .all() as PauseRow[]
    ).map((row) => this.toTarget(row));
  }

  get(writeTargetNodeId: string): AdvancedBlockingPauseTarget | undefined {
    const row = this.requireDb()
      .prepare(
        `SELECT * FROM advanced_blocking_pauses WHERE write_target_node_id = ?`,
      )
      .get(writeTargetNodeId) as PauseRow | undefined;
    return row ? this.toTarget(row) : undefined;
  }

  isEnforced(writeTargetNodeId: string): boolean {
    const target = this.get(writeTargetNodeId);
    return target?.status === "active" || target?.status === "resume-pending";
  }

  beginPause(writeTargetNodeId: string, expiresAt: string): void {
    const now = new Date().toISOString();
    this.requireDb()
      .prepare(
        `
        INSERT INTO advanced_blocking_pauses (
          write_target_node_id, status, expires_at, updated_at
        ) VALUES (?, 'pause-pending', ?, ?)
        ON CONFLICT(write_target_node_id) DO UPDATE SET
          expires_at = excluded.expires_at,
          status = CASE
            WHEN advanced_blocking_pauses.status = 'resume-pending' THEN 'active'
            ELSE advanced_blocking_pauses.status
          END,
          last_error = NULL,
          updated_at = excluded.updated_at
      `,
      )
      .run(writeTargetNodeId, expiresAt, now);
  }

  activate(
    writeTargetNodeId: string,
    previousPresent: boolean,
    previousValue: boolean | undefined,
  ): void {
    this.requireDb()
      .prepare(
        `
        UPDATE advanced_blocking_pauses
        SET status = 'active', previous_enable_blocking_present = ?,
            previous_enable_blocking_value = ?, last_error = NULL, updated_at = ?
        WHERE write_target_node_id = ?
      `,
      )
      .run(
        previousPresent ? 1 : 0,
        previousValue === undefined ? null : previousValue ? 1 : 0,
        new Date().toISOString(),
        writeTargetNodeId,
      );
  }

  markResumePending(writeTargetNodeId: string, error: string): void {
    this.requireDb()
      .prepare(
        `
        UPDATE advanced_blocking_pauses
        SET status = 'resume-pending', last_error = ?, updated_at = ?
        WHERE write_target_node_id = ?
      `,
      )
      .run(error, new Date().toISOString(), writeTargetNodeId);
  }

  markPausePendingError(writeTargetNodeId: string, error: string): void {
    this.requireDb()
      .prepare(
        `
        UPDATE advanced_blocking_pauses
        SET last_error = ?, updated_at = ?
        WHERE write_target_node_id = ?
      `,
      )
      .run(error, new Date().toISOString(), writeTargetNodeId);
  }

  remove(writeTargetNodeId: string): void {
    this.requireDb()
      .prepare(
        `DELETE FROM advanced_blocking_pauses WHERE write_target_node_id = ?`,
      )
      .run(writeTargetNodeId);
  }

  private requireDb() {
    const db = this.companionDb.db;
    if (!db) {
      throw new Error(
        "Companion SQLite is unavailable; Advanced Blocking pauses cannot be managed safely.",
      );
    }
    return db;
  }

  private toTarget(row: PauseRow): AdvancedBlockingPauseTarget {
    return {
      writeTargetNodeId: row.write_target_node_id,
      status: row.status,
      expiresAt: row.expires_at,
      ...(row.previous_enable_blocking_present === null
        ? {}
        : {
            previousEnableBlockingPresent:
              row.previous_enable_blocking_present === 1,
          }),
      ...(row.previous_enable_blocking_value === null
        ? {}
        : {
            previousEnableBlockingValue:
              row.previous_enable_blocking_value === 1,
          }),
      ...(row.last_error ? { lastError: row.last_error } : {}),
      updatedAt: row.updated_at,
    };
  }
}
