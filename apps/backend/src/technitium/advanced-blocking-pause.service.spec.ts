import { AdvancedBlockingPauseService } from "./advanced-blocking-pause.service";

describe("AdvancedBlockingPauseService", () => {
  const create = () => {
    const pauseState = {
      list: jest.fn(() => []),
      beginPause: jest.fn(),
      markActivationPending: jest.fn(),
      markResumePending: jest.fn(),
      remove: jest.fn(),
    };
    const advancedBlocking = {
      resolvePauseTarget: jest.fn(),
      activatePauseRoot: jest.fn(),
      restorePauseRoot: jest.fn(),
    };
    const schedules = { runNow: jest.fn() };
    const technitium = {
      listNodes: jest.fn(),
      assertSessionConfigWriteAccess: jest.fn(),
    };
    return {
      service: new AdvancedBlockingPauseService(
        pauseState as never,
        advancedBlocking as never,
        schedules as never,
        technitium as never,
      ),
      pauseState,
      advancedBlocking,
      schedules,
      technitium,
    };
  };

  it("keeps Built-in-only deployments on the existing pause path", async () => {
    const { service, technitium, advancedBlocking } = create();
    technitium.listNodes.mockResolvedValue([
      { id: "built-in", hasAdvancedBlocking: false },
    ]);

    await service.pause(15);

    expect(technitium.assertSessionConfigWriteAccess).not.toHaveBeenCalled();
    expect(advancedBlocking.activatePauseRoot).not.toHaveBeenCalled();
  });

  it("checks interactive Apps Modify admission before schedule credentials", async () => {
    const { service, technitium, advancedBlocking } = create();
    technitium.listNodes.mockResolvedValue([
      { id: "advanced", hasAdvancedBlocking: true },
    ]);
    technitium.assertSessionConfigWriteAccess.mockRejectedValue(
      new Error("forbidden"),
    );

    await expect(service.pause(15)).rejects.toThrow("forbidden");

    expect(advancedBlocking.resolvePauseTarget).not.toHaveBeenCalled();
    expect(advancedBlocking.activatePauseRoot).not.toHaveBeenCalled();
  });

  it("retains pause ownership when schedule reconciliation reports recovery work", async () => {
    const { service, pauseState, advancedBlocking, schedules } = create();
    schedules.runNow.mockResolvedValue({ errored: 1, pendingRecoveryCount: 0 });
    const target = {
      writeTargetNodeId: "node:primary",
      anchorNodeId: "primary",
      status: "active" as const,
      expiresAt: new Date(0).toISOString(),
      previousEnableBlockingPresent: true,
      previousEnableBlockingValue: true,
      updatedAt: new Date().toISOString(),
    };

    await (
      service as unknown as { tryResume(value: typeof target): Promise<void> }
    ).tryResume(target);

    expect(advancedBlocking.restorePauseRoot).not.toHaveBeenCalled();
    expect(pauseState.markResumePending).toHaveBeenCalledWith(
      "node:primary",
      expect.stringContaining("incomplete"),
    );
  });
});
