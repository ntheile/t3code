import { useEffect } from "react";
import type { RefObject } from "react";

const AXIS_LOCK_THRESHOLD_PX = 6;

function getTouchById(touchList: TouchList, touchId: number): Touch | null {
  for (let i = 0; i < touchList.length; i += 1) {
    const touch = touchList.item(i);
    if (touch?.identifier === touchId) {
      return touch;
    }
  }

  return null;
}

function hasStackedDiffHostInPath(event: TouchEvent): boolean {
  return event
    .composedPath()
    .some((entry) => entry instanceof HTMLElement && entry.classList.contains("diff-render-host"));
}

export function useMobileStackedDiffPan(rootRef: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const container = rootRef.current?.querySelector<HTMLElement>(".diff-render-surface");
    if (!enabled || container == null) {
      return;
    }

    let activeTouchId: number | null = null;
    let axisLock: "pending" | "horizontal" | "vertical" | null = null;
    let startClientX = 0;
    let startClientY = 0;
    let startScrollLeft = 0;

    const clearGesture = () => {
      activeTouchId = null;
      axisLock = null;
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !hasStackedDiffHostInPath(event)) {
        clearGesture();
        return;
      }

      const touch = event.touches.item(0);
      if (touch == null) {
        clearGesture();
        return;
      }

      activeTouchId = touch.identifier;
      axisLock = "pending";
      startClientX = touch.clientX;
      startClientY = touch.clientY;
      startScrollLeft = container.scrollLeft;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (activeTouchId == null) {
        return;
      }

      const touch = getTouchById(event.touches, activeTouchId);
      if (touch == null) {
        clearGesture();
        return;
      }

      const deltaX = touch.clientX - startClientX;
      const deltaY = touch.clientY - startClientY;

      if (axisLock === "pending") {
        if (
          Math.abs(deltaX) < AXIS_LOCK_THRESHOLD_PX &&
          Math.abs(deltaY) < AXIS_LOCK_THRESHOLD_PX
        ) {
          return;
        }

        axisLock = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
      }

      if (axisLock !== "horizontal") {
        return;
      }

      event.preventDefault();
      container.scrollLeft = startScrollLeft - deltaX;
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (activeTouchId != null && getTouchById(event.changedTouches, activeTouchId) != null) {
        clearGesture();
      }
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [enabled, rootRef]);
}
