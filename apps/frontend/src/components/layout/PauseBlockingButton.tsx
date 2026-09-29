import {
  faCaretDown,
  faCheck,
  faCircleNotch,
  faPause,
  faPlay,
  faShieldHalved,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalTechnitiumState } from "../../context/useTechnitiumState";
import { useToast } from "../../context/useToast";

type DurationPreset = {
  label: string;
  minutes: number;
};

const DURATION_PRESETS: DurationPreset[] = [
  { label: "1 minute", minutes: 1 },
  { label: "5 minutes", minutes: 5 },
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "4 hours", minutes: 240 },
];

function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return "expiring";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export function PauseBlockingButton() {
  const technitium = useOptionalTechnitiumState();
  const { pushToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const containerRef = useRef<HTMLDivElement | null>(null);

  const builtInBlockingNodes = technitium?.builtInBlocking?.nodes;
  const nodes = useMemo(
    () => builtInBlockingNodes ?? [],
    [builtInBlockingNodes],
  );
  const usingAdvancedBlocking =
    technitium?.selectedBlockingMethod === "advanced";
  const advancedPause = technitium?.advancedBlockingPause;

  useEffect(() => {
    if (usingAdvancedBlocking) {
      void technitium?.reloadAdvancedBlockingPause().catch(() => undefined);
    }
  }, [technitium, usingAdvancedBlocking]);

  const { pausedNodes, latestPauseUntilMs } = useMemo(() => {
    let latest = 0;
    const paused: { nodeId: string; untilMs: number }[] = [];
    for (const snap of nodes) {
      const raw = snap.metrics?.temporaryDisableBlockingTill;
      if (!raw) {
        continue;
      }
      const parsed = Date.parse(raw);
      if (Number.isNaN(parsed) || parsed <= Date.now()) {
        continue;
      }
      paused.push({ nodeId: snap.nodeId, untilMs: parsed });
      if (parsed > latest) {
        latest = parsed;
      }
    }
    return { pausedNodes: paused, latestPauseUntilMs: latest };
  }, [nodes]);

  const advancedLatestPauseUntilMs = useMemo(
    () =>
      Math.max(
        0,
        ...(advancedPause?.targets.map((target) =>
          Date.parse(target.expiresAt),
        ) ?? []),
      ),
    [advancedPause],
  );
  const isPaused = usingAdvancedBlocking
    ? Boolean(advancedPause?.paused)
    : pausedNodes.length > 0;
  const effectivePauseUntilMs = usingAdvancedBlocking
    ? advancedLatestPauseUntilMs
    : latestPauseUntilMs;

  useEffect(() => {
    if (!isPaused) {
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isPaused]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (containerRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  const targetNodeIdsForPause = useMemo(
    () =>
      nodes
        .filter((snap) => snap.isHealthy && snap.metrics?.blockingEnabled)
        .map((snap) => snap.nodeId),
    [nodes],
  );

  const handlePause = useCallback(
    async (minutes: number) => {
      if (!technitium) return;
      setMenuOpen(false);
      setBusy(true);
      try {
        if (usingAdvancedBlocking) {
          const status = await technitium.pauseAdvancedBlocking(minutes);
          await technitium.reloadAdvancedBlocking().catch(() => undefined);
          const errors = status.targets
            .filter((target) => target.lastError)
            .map(
              (target) => `${target.writeTargetNodeId}: ${target.lastError}`,
            );
          if (errors.length) {
            pushToast({
              message: `Paused with errors: ${errors.join("; ")}`,
              tone: "error",
            });
          } else {
            const preset = DURATION_PRESETS.find((p) => p.minutes === minutes);
            pushToast({
              message: `Advanced Blocking paused for ${preset?.label ?? `${minutes} min`}.`,
              tone: "success",
            });
          }
          return;
        }
        if (targetNodeIdsForPause.length === 0) {
          pushToast({
            message: "No nodes with blocking enabled to pause.",
            tone: "info",
          });
          return;
        }
        const errors: string[] = [];
        await Promise.all(
          targetNodeIdsForPause.map(async (nodeId) => {
            try {
              await technitium.temporaryDisableBlocking(nodeId, minutes);
            } catch (error) {
              errors.push(
                `${nodeId}: ${error instanceof Error ? error.message : "failed"}`,
              );
            }
          }),
        );
        await technitium.reloadBuiltInBlocking().catch(() => undefined);
        if (errors.length) {
          pushToast({
            message: `Paused with errors: ${errors.join("; ")}`,
            tone: "error",
          });
        } else {
          const preset = DURATION_PRESETS.find((p) => p.minutes === minutes);
          pushToast({
            message: `Blocking paused for ${preset?.label ?? `${minutes} min`}.`,
            tone: "success",
          });
        }
      } catch (error) {
        pushToast({
          message: `Failed to pause blocking: ${error instanceof Error ? error.message : "failed"}`,
          tone: "error",
        });
      } finally {
        setBusy(false);
      }
    },
    [technitium, targetNodeIdsForPause, pushToast, usingAdvancedBlocking],
  );

  const handleResume = useCallback(async () => {
    if (!technitium) return;
    setMenuOpen(false);
    setBusy(true);
    try {
      if (usingAdvancedBlocking) {
        const status = await technitium.resumeAdvancedBlocking();
        await technitium.reloadAdvancedBlocking().catch(() => undefined);
        const errors = status.targets
          .filter((target) => target.lastError)
          .map((target) => `${target.writeTargetNodeId}: ${target.lastError}`);
        pushToast(
          errors.length
            ? {
                message: `Resume failed for some nodes: ${errors.join("; ")}`,
                tone: "error",
              }
            : { message: "Advanced Blocking resumed.", tone: "success" },
        );
        return;
      }
      const errors: string[] = [];
      await Promise.all(
        pausedNodes.map(async ({ nodeId }) => {
          try {
            await technitium.reEnableBlocking(nodeId);
          } catch (error) {
            errors.push(
              `${nodeId}: ${error instanceof Error ? error.message : "failed"}`,
            );
          }
        }),
      );
      await technitium.reloadBuiltInBlocking().catch(() => undefined);
      pushToast(
        errors.length
          ? {
              message: `Resume failed for some nodes: ${errors.join("; ")}`,
              tone: "error",
            }
          : { message: "Blocking resumed.", tone: "success" },
      );
    } catch (error) {
      pushToast({
        message: `Failed to resume blocking: ${error instanceof Error ? error.message : "failed"}`,
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }, [technitium, pausedNodes, pushToast, usingAdvancedBlocking]);
  const anyBlockingEnabled = useMemo(
    () => nodes.some((snap) => snap.isHealthy && snap.metrics?.blockingEnabled),
    [nodes],
  );

  const anyAdvancedEnabled = Boolean(
    technitium?.blockingStatus?.nodes.some(
      (node) => node.advancedBlockingEnabled,
    ),
  );

  if (!technitium || (!usingAdvancedBlocking && nodes.length === 0)) {
    return null;
  }

  if (
    !(usingAdvancedBlocking ? anyAdvancedEnabled : anyBlockingEnabled) &&
    !isPaused
  ) {
    return null;
  }

  const remainingSeconds = isPaused
    ? Math.max(0, Math.floor((effectivePauseUntilMs - now) / 1000))
    : 0;
  const countdownLabel = isPaused ? formatCountdown(remainingSeconds) : null;

  const pillClassName = [
    "app-header__pause",
    isPaused ? "app-header__pause--paused" : "app-header__pause--active",
    menuOpen ? "app-header__pause--open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="app-header__pause-wrapper" ref={containerRef}>
      <button
        type="button"
        className={pillClassName}
        onClick={() => setMenuOpen((open) => !open)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={
          isPaused
            ? `Blocking paused, ${countdownLabel} remaining`
            : "Pause blocking"
        }
        title={
          isPaused
            ? `Blocking paused — ${countdownLabel} remaining`
            : "Pause DNS blocking"
        }
      >
        <FontAwesomeIcon
          icon={busy ? faCircleNotch : isPaused ? faPause : faShieldHalved}
          spin={busy}
        />
        <span className="app-header__pause-label">
          {busy
            ? "Working…"
            : isPaused
              ? `Paused · ${countdownLabel}`
              : "Active"}
        </span>
        <FontAwesomeIcon
          icon={faCaretDown}
          className="app-header__pause-caret"
        />
      </button>
      {menuOpen && (
        <div className="app-header__pause-menu" role="menu">
          {isPaused && (
            <>
              <button
                type="button"
                className="app-header__actions-item"
                onClick={() => {
                  void handleResume();
                }}
                role="menuitem"
              >
                <FontAwesomeIcon icon={faPlay} />
                <span>Resume now</span>
              </button>
              <div className="app-header__actions-divider" aria-hidden="true" />
              <div className="app-header__actions-group-label">
                Extend pause
              </div>
            </>
          )}
          {!isPaused && (
            <div className="app-header__actions-group-label">
              Pause blocking for
            </div>
          )}
          {DURATION_PRESETS.map((preset) => (
            <button
              key={preset.minutes}
              type="button"
              className="app-header__actions-item"
              onClick={() => {
                void handlePause(preset.minutes);
              }}
              role="menuitem"
            >
              <FontAwesomeIcon icon={faPause} />
              <span>{preset.label}</span>
              {isPaused && remainingSeconds > 0 && (
                <span className="app-header__actions-item-check">
                  <FontAwesomeIcon icon={faCheck} style={{ opacity: 0 }} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
