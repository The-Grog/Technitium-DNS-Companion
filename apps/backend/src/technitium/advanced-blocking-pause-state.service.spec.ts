import { DatabaseSync } from "node:sqlite";
import { AdvancedBlockingPauseStateService } from "./advanced-blocking-pause-state.service";

describe("Advanced Blocking pause SQLite migration", () => {
  it("rebuilds the legacy constraint idempotently and preserves true, false, and absent baselines", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(
        "CREATE TABLE advanced_blocking_pauses (write_target_node_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('pause-pending','active','resume-pending')), expires_at TEXT NOT NULL, previous_enable_blocking_present INTEGER, previous_enable_blocking_value INTEGER, last_error TEXT, updated_at TEXT NOT NULL)",
      );
      const insert = db.prepare(
        "INSERT INTO advanced_blocking_pauses VALUES (?, 'pause-pending', '2030-01-01', ?, ?, NULL, 'old')",
      );
      insert.run("true", 1, 1);
      insert.run("false", 1, 0);
      insert.run("absent", 0, null);
      insert.run("unknown", null, null);
      const state = new AdvancedBlockingPauseStateService({ db } as never);
      state.onModuleInit();
      state.onModuleInit();
      for (const id of ["true", "false", "absent", "unknown"])
        state.migrateLegacyKey(id, "node:" + id);
      expect(state.get("node:true")?.previousEnableBlockingValue).toBe(true);
      expect(state.get("node:false")?.previousEnableBlockingValue).toBe(false);
      expect(state.get("node:absent")?.previousEnableBlockingPresent).toBe(
        false,
      );
      expect(state.get("node:unknown")?.captureBeforeWrite).toBe(false);
      expect(state.isEnforced("node:unknown")).toBe(false);
      state.beginPause("node:new", "new", "2030-01-01");
      expect(state.get("node:new")?.captureBeforeWrite).toBe(true);
    } finally {
      db.close();
    }
  });
});
