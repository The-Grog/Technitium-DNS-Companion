import { AdvancedBlockingPauseService } from "./advanced-blocking-pause.service";

describe("AdvancedBlockingPauseService", () => {
  const create = () => {
    const pauseState = { list: jest.fn(() => []), get: jest.fn(), beginPause: jest.fn(), markActivationPending: jest.fn(), markResumePending: jest.fn(), remove: jest.fn(), migrateLegacyKey: jest.fn(), adoptResolvedAnchor: jest.fn(), markVerified: jest.fn() };
    const advancedBlocking = { resolvePauseTarget: jest.fn(), activatePauseRoot: jest.fn(), verifyPauseRoot: jest.fn(), restorePauseRoot: jest.fn() };
    const schedules = { runNow: jest.fn() };
    const technitium = { listNodes: jest.fn(), getConfiguredNodeGroupId: jest.fn(), assertSessionConfigWriteAccess: jest.fn(), assertSessionConfigWriteTargets: jest.fn() };
    return { service: new AdvancedBlockingPauseService(pauseState as never, advancedBlocking as never, schedules as never, technitium as never), pauseState, advancedBlocking, schedules, technitium };
  };

  it("keeps Built-in-only deployments on the existing pause path", async () => {
    const { service, technitium, advancedBlocking } = create();
    technitium.listNodes.mockResolvedValue([{ id: "built-in", hasAdvancedBlocking: false }]);
    await service.pause(15);
    expect(technitium.assertSessionConfigWriteTargets).not.toHaveBeenCalled();
    expect(advancedBlocking.activatePauseRoot).not.toHaveBeenCalled();
  });

  it("checks interactive Apps Modify admission before schedule credentials", async () => {
    const { service, technitium, advancedBlocking } = create();
    technitium.listNodes.mockResolvedValue([{ id: "advanced", hasAdvancedBlocking: true }]);
    advancedBlocking.verifyPauseRoot.mockResolvedValue({ targetKey: "node:advanced", writeNodeId: "advanced", paused: false });
    advancedBlocking.resolvePauseTarget.mockResolvedValue({ targetKey: "node:advanced", writeNodeId: "advanced" });
    technitium.assertSessionConfigWriteTargets.mockRejectedValue(new Error("forbidden"));
    await expect(service.pause(15)).rejects.toThrow("forbidden");
    expect(advancedBlocking.resolvePauseTarget).toHaveBeenCalledWith(
      "advanced",
      "session",
      true,
    );
    expect(advancedBlocking.activatePauseRoot).not.toHaveBeenCalled();
  });

  it("retains pause ownership when schedule reconciliation reports recovery work", async () => {
    const { service, pauseState, advancedBlocking, schedules } = create();
    schedules.runNow.mockResolvedValue({ errored: 1, pendingRecoveryCount: 0 });
    const target = { writeTargetNodeId: "node:primary", anchorNodeId: "primary", status: "active" as const, expiresAt: new Date(0).toISOString(), previousEnableBlockingPresent: true, previousEnableBlockingValue: true, updatedAt: new Date().toISOString() };
    pauseState.get.mockReturnValue(target);
    await (service as unknown as { tryResume(value: typeof target): Promise<void> }).tryResume(target);
    expect(advancedBlocking.restorePauseRoot).not.toHaveBeenCalled();
    expect(pauseState.markResumePending).toHaveBeenCalledWith("node:primary", expect.stringContaining("incomplete"));
  });

  it("does not restore when an extension changes durable ownership during reconciliation", async () => {
    const { service, pauseState, advancedBlocking, schedules } = create();
    const target = { writeTargetNodeId: "cluster:default:dns.example", anchorNodeId: "primary", status: "active" as const, expiresAt: new Date(0).toISOString(), previousEnableBlockingPresent: true, previousEnableBlockingValue: true, updatedAt: "2026-01-01T00:00:00.000Z" };
    schedules.runNow.mockResolvedValue({ errored: 0, pendingRecoveryCount: 0 });
    advancedBlocking.restorePauseRoot.mockImplementation(async (_nodeId: string, _previous: boolean, _mode: string, _onRestored: (key: string) => void, beforeRestore: (value: { targetKey: string; writeNodeId: string }) => void) => beforeRestore({ targetKey: target.writeTargetNodeId, writeNodeId: "primary" }));
    pauseState.get.mockReturnValue({ ...target, expiresAt: "2026-01-01T01:00:00.000Z", updatedAt: "2026-01-01T00:30:00.000Z" });
    await (service as unknown as { tryResume(value: typeof target): Promise<void> }).tryResume(target);
    expect(pauseState.remove).not.toHaveBeenCalled();
    expect(pauseState.markResumePending).toHaveBeenCalledWith(target.writeTargetNodeId, expect.stringContaining("changed"));
  });
  it("adopts a recovered Primary before canonical-row operations continue", async () => {
    const { service, pauseState, advancedBlocking, technitium } = create();
    const target = { writeTargetNodeId: "cluster:group:dns.example", anchorNodeId: "former-primary", status: "active" as const, expiresAt: "2030-01-01T00:00:00.000Z", updatedAt: "2029-01-01T00:00:00.000Z" };
    advancedBlocking.resolvePauseTarget.mockRejectedValueOnce(new Error("former primary unreachable")).mockResolvedValue({ targetKey: target.writeTargetNodeId, writeNodeId: "replacement-primary" });
    technitium.getConfiguredNodeGroupId.mockReturnValue("group");
    technitium.listNodes.mockResolvedValue([{ id: "replacement-primary", groupId: "group" }]);
    const resolved = await (service as unknown as { resolveDurableTarget(value: typeof target): Promise<typeof target> }).resolveDurableTarget(target);
    expect(pauseState.adoptResolvedAnchor).toHaveBeenCalledWith(target.writeTargetNodeId, "replacement-primary");
    expect(resolved).toMatchObject({ anchorNodeId: "replacement-primary" });
  });
});