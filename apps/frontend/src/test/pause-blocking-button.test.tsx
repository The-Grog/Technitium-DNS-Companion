import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("../context/useTechnitiumState", () => ({ useOptionalTechnitiumState: () => state.current }));
vi.mock("../context/useToast", () => ({ useToast: () => ({ pushToast: vi.fn() }) }));

import { PauseBlockingButton } from "../components/layout/PauseBlockingButton";

const pause = { paused: true, confirmedPausedTargetCount: 1, pendingTargetCount: 0, targets: [{ writeTargetNodeId: "cluster:default:dns.example", status: "active" as const, expiresAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z" }] };

describe("PauseBlockingButton", () => {
  it("renders for installed and enabled Advanced Blocking without a Built-in overview", async () => {
    const reloadAdvancedBlockingPause = vi.fn().mockResolvedValue(undefined);
    state.current = {
      blockingStatus: {
        nodes: [
          {
            nodeId: "dns1",
            builtInEnabled: false,
            advancedBlockingInstalled: true,
            advancedBlockingEnabled: true,
          },
          {
            nodeId: "dns2",
            builtInEnabled: false,
            advancedBlockingInstalled: true,
            advancedBlockingEnabled: true,
          },
        ],
      },
      reloadAdvancedBlockingPause,
    };

    render(<PauseBlockingButton />);

    expect(
      screen.getByRole("button", { name: "Pause blocking" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(reloadAdvancedBlockingPause).toHaveBeenCalled());
  });
  it("keeps a confirmed Advanced pause visible after its live root flag is false", async () => {
    const reloadAdvancedBlockingPause = vi.fn().mockResolvedValue(undefined);
    const resumeAdvancedBlocking = vi.fn().mockResolvedValue({ ...pause, paused: false, confirmedPausedTargetCount: 0, targets: [] });
    state.current = { blockingStatus: { nodes: [{ nodeId: "advanced", advancedBlockingInstalled: true, advancedBlockingEnabled: false }] }, advancedBlockingPause: pause, reloadAdvancedBlockingPause, resumeAdvancedBlocking, reloadAdvancedBlocking: vi.fn().mockResolvedValue(undefined), reloadBuiltInBlocking: vi.fn().mockResolvedValue(undefined), builtInBlocking: { nodes: [] } };
    render(<PauseBlockingButton />);
    expect(screen.getByText(/Paused/)).toBeInTheDocument();
    await waitFor(() => expect(reloadAdvancedBlockingPause).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Blocking paused/i }));
    const resume = screen.getByRole("menuitem", { name: /Resume now/i });
    expect(resume).toBeInTheDocument();
    fireEvent.click(resume);
    await waitFor(() => expect(resumeAdvancedBlocking).toHaveBeenCalled());
  });

  it("resumes both effective methods in a mixed deployment", async () => {
    const resumeAdvancedBlocking = vi.fn().mockResolvedValue({ ...pause, paused: false, confirmedPausedTargetCount: 0, targets: [] });
    const reEnableBlocking = vi.fn().mockResolvedValue(undefined);
    state.current = { blockingStatus: { nodes: [{ nodeId: "advanced", advancedBlockingInstalled: true, advancedBlockingEnabled: true }, { nodeId: "built-in", advancedBlockingInstalled: false, advancedBlockingEnabled: false }] }, advancedBlockingPause: pause, reloadAdvancedBlockingPause: vi.fn().mockResolvedValue(undefined), resumeAdvancedBlocking, reloadAdvancedBlocking: vi.fn().mockResolvedValue(undefined), reEnableBlocking, reloadBuiltInBlocking: vi.fn().mockResolvedValue(undefined), builtInBlocking: { nodes: [{ nodeId: "built-in", isHealthy: true, metrics: { temporaryDisableBlockingTill: "2030-01-01T00:00:00.000Z" } }] } };
    render(<PauseBlockingButton />);
    fireEvent.click(screen.getByRole("button", { name: /Blocking paused/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Resume now/i }));
    await waitFor(() => expect(resumeAdvancedBlocking).toHaveBeenCalled());
    await waitFor(() => expect(reEnableBlocking).toHaveBeenCalledWith("built-in"));
  });
});