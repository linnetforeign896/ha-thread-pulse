import test from "node:test";
import assert from "node:assert/strict";

// The handler only needs a window with timers and listeners; Node has EventTarget and CustomEvent.
globalThis.window ??= Object.assign(new EventTarget(), { setTimeout, clearTimeout });

const { bindActionHandler } = await import("../src/action-handler.ts");

/** A stand-in element that records the actions it emits. */
function element(options = {}, tagName = "DIV") {
  const el = Object.assign(new EventTarget(), { tagName, __apcOptions: options });
  el.actions = [];
  el.addEventListener("apc-action", (ev) => el.actions.push(ev.detail.action));
  bindActionHandler(el);
  return el;
}
const ev = (type, props = {}) => Object.assign(new Event(type, { cancelable: true }), { button: 0, clientX: 0, clientY: 0, detail: 1, ...props });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("a tap is emitted on click, not on pointerup (issue #27)", () => {
  const el = element();
  el.dispatchEvent(ev("pointerdown"));
  el.dispatchEvent(ev("pointerup"));
  assert.deepEqual(el.actions, [], "nothing opens before the browser's click, so the click can't land on it");
  el.dispatchEvent(ev("click"));
  assert.deepEqual(el.actions, ["tap"]);
});

test("a hold fires while pressed and swallows the click that follows it, wherever it lands", async () => {
  const el = element({ hasHold: true });
  el.dispatchEvent(ev("pointerdown"));
  await sleep(550);
  assert.deepEqual(el.actions, ["hold"]);
  el.dispatchEvent(ev("pointerup"));
  // The browser's click after a long press is hit-tested again, onto whatever the hold opened.
  const underFinger = [];
  window.addEventListener("click", () => underFinger.push("click"));
  const ghost = ev("click");
  window.dispatchEvent(ghost);
  assert.deepEqual(underFinger, [], "the popup row under the finger never sees the click");
  assert.ok(ghost.defaultPrevented);
  // Only that one click: the next one goes through.
  window.dispatchEvent(ev("click"));
  assert.deepEqual(underFinger, ["click"]);
  // A click on the element itself after a hold is not a tap either.
  el.dispatchEvent(ev("click"));
  assert.deepEqual(el.actions, ["hold"]);
});

test("the click guard after a hold expires when no click comes", async () => {
  const el = element({ hasHold: true });
  el.dispatchEvent(ev("pointerdown"));
  await sleep(550);
  el.dispatchEvent(ev("pointerup"));
  await sleep(500);
  const seen = [];
  const l = () => seen.push("click");
  window.addEventListener("click", l);
  window.dispatchEvent(ev("click"));
  window.removeEventListener("click", l);
  assert.deepEqual(seen, ["click"]);
});

test("a short press on a holdable element is a tap; moving away cancels it", async () => {
  const el = element({ hasHold: true });
  el.dispatchEvent(ev("pointerdown"));
  el.dispatchEvent(ev("pointerup"));
  el.dispatchEvent(ev("click"));
  assert.deepEqual(el.actions, ["tap"]);
  el.dispatchEvent(ev("pointerdown"));
  el.dispatchEvent(ev("pointermove", { clientX: 40 }));
  el.dispatchEvent(ev("pointerup", { clientX: 40 }));
  el.dispatchEvent(ev("click"));
  await sleep(550);
  assert.deepEqual(el.actions, ["tap"], "no tap and no hold after a drag");
});

test("double tap counts clicks; a single tap waits for the double-tap window", async () => {
  const el = element({ hasDoubleTap: true });
  for (let i = 0; i < 2; i++) {
    el.dispatchEvent(ev("pointerdown"));
    el.dispatchEvent(ev("pointerup"));
    el.dispatchEvent(ev("click"));
  }
  assert.deepEqual(el.actions, ["double_tap"]);
  el.dispatchEvent(ev("pointerdown"));
  el.dispatchEvent(ev("pointerup"));
  el.dispatchEvent(ev("click"));
  assert.deepEqual(el.actions, ["double_tap"]);
  await sleep(300);
  assert.deepEqual(el.actions, ["double_tap", "tap"]);
});

test("keyboard: Enter on a role=button element taps; a native button taps through its own click", () => {
  const div = element({ hasDoubleTap: true });
  div.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "Enter" }));
  assert.deepEqual(div.actions, ["tap"]);
  const button = element({ hasDoubleTap: true }, "BUTTON");
  button.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "Enter" }));
  assert.deepEqual(button.actions, [], "the browser turns Enter into a click on a <button>");
  button.dispatchEvent(ev("click", { detail: 0 }));
  assert.deepEqual(button.actions, ["tap"], "keyboard clicks tap at once, without the double-tap wait");
});

test("a disabled element emits nothing", () => {
  const el = element({ disabled: true });
  el.dispatchEvent(ev("pointerdown"));
  el.dispatchEvent(ev("pointerup"));
  el.dispatchEvent(ev("click"));
  el.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "Enter" }));
  assert.deepEqual(el.actions, []);
});
