import { noChange } from "lit";
import { Directive, directive, type ElementPart, type PartInfo, PartType } from "lit/directive.js";

export type ActionKind = "tap" | "hold" | "double_tap";

export interface ActionHandlerOptions {
  hasHold?: boolean;
  hasDoubleTap?: boolean;
  disabled?: boolean;
}

interface HandlerElement extends HTMLElement {
  __tpcOptions?: ActionHandlerOptions;
  __tpcBound?: boolean;
}

const HOLD_MS = 500;
const DOUBLE_TAP_MS = 250;
/** How long after a hold ends the browser may still send that press's `click` (a long-press "tap"). */
const GHOST_CLICK_MS = 450;

let swallowUntil = 0;
let guardInstalled = false;

/**
 * Swallow the next `click` anywhere on the page, within `ms`. Used after a hold: the hold already did
 * something (opened a dialog, say) while the finger was still down, and the `click` some browsers send
 * when it lifts is hit-tested again, so it would land on whatever opened under the finger.
 */
function swallowNextClick(ms: number) {
  swallowUntil = Date.now() + ms;
  if (guardInstalled) return;
  guardInstalled = true;
  // One capture listener on the window for the page's lifetime: it runs before anything else sees the click.
  window.addEventListener(
    "click",
    (ev: Event) => {
      if (Date.now() > swallowUntil) return;
      swallowUntil = 0;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    },
    true
  );
}

/**
 * Tap / hold / double-tap on one element.
 *
 * A tap is taken from the element's own `click`, never from `pointerup`. On a touch screen the browser
 * sends `click` (and its mouse events) after the finger lifts, hit-testing the spot again; if the tap had
 * already opened a popup on `pointerup`, that `click` landed on whatever was now under the finger (issue
 * #27). `click` is the last event of a tap, so nothing a tap opens can receive the same tap. A hold fires
 * while the finger is still down, so it swallows the one `click` that may follow it.
 */
export function bindActionHandler(el: HandlerElement) {
  if (el.__tpcBound) return;
  el.__tpcBound = true;
  // A native <button> turns Enter and Space into a `click` itself; other elements need the keys handled.
  const nativeButton = el.tagName === "BUTTON";
  const opts = () => el.__tpcOptions ?? {};
  let holdTimer: number | undefined;
  let tapTimer: number | undefined;
  /** The current press turned into a hold: its click is not a tap. */
  let held = false;
  /** The current press moved away (only matters when a hold is possible): its click is not a tap. */
  let cancelled = false;
  let startX = 0;
  let startY = 0;

  const emit = (action: ActionKind) =>
    el.dispatchEvent(new CustomEvent("tpc-action", { detail: { action }, bubbles: false, composed: false }));
  const clearHold = () => {
    if (holdTimer) window.clearTimeout(holdTimer);
    holdTimer = undefined;
  };
  const cancelHold = () => {
    if (!holdTimer) return;
    clearHold();
    cancelled = true;
  };

  el.addEventListener("pointerdown", (ev: PointerEvent) => {
    if (opts().disabled || ev.button !== 0) return;
    held = false;
    cancelled = false;
    startX = ev.clientX;
    startY = ev.clientY;
    clearHold();
    if (opts().hasHold) {
      holdTimer = window.setTimeout(() => {
        held = true;
        holdTimer = undefined;
        if (navigator.vibrate) navigator.vibrate(30);
        emit("hold");
      }, HOLD_MS);
    }
  });
  el.addEventListener("pointermove", (ev: PointerEvent) => {
    if (holdTimer && (Math.abs(ev.clientX - startX) > 10 || Math.abs(ev.clientY - startY) > 10)) cancelHold();
  });
  el.addEventListener("pointercancel", () => {
    cancelHold();
    if (held) swallowNextClick(GHOST_CLICK_MS);
  });
  el.addEventListener("pointerleave", cancelHold);
  el.addEventListener("contextmenu", (ev) => {
    if (opts().hasHold) ev.preventDefault();
  });
  el.addEventListener("pointerup", (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    clearHold();
    if (held) swallowNextClick(GHOST_CLICK_MS);
  });
  el.addEventListener("click", (ev: MouseEvent) => {
    if (opts().disabled) return;
    // A keyboard or assistive-technology activation (no pointer behind it): a plain tap, right away.
    if (ev.detail === 0) {
      emit("tap");
      return;
    }
    if (held || cancelled) {
      held = false;
      cancelled = false;
      return;
    }
    if (opts().hasDoubleTap) {
      if (tapTimer) {
        window.clearTimeout(tapTimer);
        tapTimer = undefined;
        emit("double_tap");
      } else {
        tapTimer = window.setTimeout(() => {
          tapTimer = undefined;
          emit("tap");
        }, DOUBLE_TAP_MS);
      }
    } else {
      emit("tap");
    }
  });
  el.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (nativeButton || opts().disabled) return;
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      emit("tap");
    }
  });
}

class ActionHandlerDirective extends Directive {
  constructor(info: PartInfo) {
    super(info);
    if (info.type !== PartType.ELEMENT) throw new Error("actionHandler must be used on an element");
  }
  update(part: ElementPart, [options]: [ActionHandlerOptions?]) {
    const el = part.element as HandlerElement;
    el.__tpcOptions = options ?? {};
    bindActionHandler(el);
    return noChange;
  }
  render(_options?: ActionHandlerOptions) {
    return noChange;
  }
}

/** Tap / hold / double-tap detection, emitting an `tpc-action` event on the element. */
export const actionHandler = directive(ActionHandlerDirective);
