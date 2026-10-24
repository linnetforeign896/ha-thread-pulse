import test from "node:test";
import assert from "node:assert/strict";

import { buildGroups, indexArea } from "../src/discovery.ts";
import { resolveLabelFilter } from "../src/labels.ts";
import { PRESETS, actionIconColor, resolveAction } from "../src/presets.ts";

const state = (entity_id, s = "off", attributes = {}) => ({
  entity_id,
  state: s,
  attributes,
  last_changed: new Date().toISOString(),
  last_updated: new Date().toISOString(),
});

function makeHass() {
  const ids = {
    "light.ceiling": { labels: ["on_card"] },
    "light.lamp": {},
    "light.strip": {},
    "switch.heater": { labels: ["on_card"] },
    "sensor.noise": { labels: ["on_card"] },
  };
  const states = {};
  const entities = {};
  for (const [id, extra] of Object.entries(ids)) {
    states[id] = state(id, id.startsWith("sensor") ? "3" : "on");
    entities[id] = { entity_id: id, area_id: "lounge", ...extra };
  }
  return { states, entities, devices: {}, areas: {}, language: "en" };
}

const area = { area_id: "lounge", name: "Lounge" };

function resolve(preset, filterCfg) {
  const hass = makeHass();
  const filter = resolveLabelFilter(filterCfg);
  const index = indexArea(hass, "lounge", [], filter);
  const groups = buildGroups(hass, {}, index);
  return resolveAction(hass, { preset }, area, groups, index, filter.active);
}

test("presets target the whole area when no label filter is set", () => {
  assert.deepEqual(resolve("lights_off").tap_action.target, { area_id: "lounge" });
  assert.deepEqual(resolve("everything_off").tap_action.target, { area_id: "lounge" });
});

test("with a label filter, presets only touch the entities the card shows", () => {
  const filter = { include: ["on_card"] };
  assert.deepEqual(resolve("lights_off", filter).tap_action.target, { entity_id: ["light.ceiling"] });
  assert.deepEqual(resolve("lights_toggle", filter).tap_action.target, { entity_id: ["light.ceiling"] });
  const all = resolve("everything_off", filter).tap_action;
  assert.equal(all.perform_action, "homeassistant.turn_off");
  assert.deepEqual([...all.target.entity_id].sort(), ["light.ceiling", "switch.heater"]);
  assert.ok(all.confirmation, "everything_off still asks for confirmation");
});

test("quick-action icons follow the tile rule: colour only while something is on", () => {
  const neutral = "var(--secondary-text-color)";
  // Lights are on in the fixture, so the toggle is active and keeps its gold icon.
  assert.equal(actionIconColor(resolve("lights_toggle"), true), "var(--apc-amber)");
  // One-way presets follow what they act on (issue #4): lights are on, so lights_on/lights_off are lit too.
  for (const p of ["lights_on", "lights_off"]) assert.equal(actionIconColor(resolve(p), true), "var(--apc-amber)", p);
  // No covers in this room, and everything_off is never lit.
  for (const p of ["everything_off", "covers_close"]) assert.equal(actionIconColor(resolve(p), true), neutral, p);
  // An idle action is neutral; chip_colors: category keeps today's coloured icons.
  const idle = { active: false, color: "var(--apc-teal)" };
  assert.equal(actionIconColor(idle, true), neutral);
  assert.equal(actionIconColor(idle, false), "var(--apc-teal)");
  assert.equal(actionIconColor(resolve("everything_off"), false), "var(--apc-red)");
});

// ---- Issue #4: the look follows the room's state ------------------------------------------------------

/** A room built from a list of states, everything in the area "lounge". */
function room(list) {
  const states = {};
  const entities = {};
  for (const s of list) {
    states[s.entity_id] = s;
    entities[s.entity_id] = { entity_id: s.entity_id, area_id: "lounge" };
  }
  const hass = { states, entities, devices: {}, areas: {}, language: "en" };
  const index = indexArea(hass, "lounge", [], resolveLabelFilter(undefined));
  const groups = buildGroups(hass, {}, index);
  return (cfg) => resolveAction(hass, cfg, area, groups, index, false);
}

test("area presets are lit while what they act on is on, whichever way they act", () => {
  const off = room([state("light.a", "off"), state("cover.blind", "closed"), state("fan.ceiling", "off")]);
  const on = room([state("light.a", "on"), state("cover.blind", "open"), state("fan.ceiling", "on")]);
  for (const preset of ["lights_toggle", "lights_on", "lights_off", "covers_open", "covers_close", "fans_off"]) {
    assert.equal(off({ preset }).active, false, `${preset} with everything off`);
    assert.equal(on({ preset }).active, true, `${preset} with everything on`);
  }
  // A cover that is opening counts as open; everything_off stays a plain action.
  assert.equal(room([state("cover.blind", "opening")])({ preset: "covers_close" }).active, true);
  assert.equal(on({ preset: "everything_off" }).active, false);
  // They still only act: lights_off never turns into a toggle.
  assert.equal(on({ preset: "lights_off" }).tap_action.perform_action, "light.turn_off");
  assert.equal(off({ preset: "lights_off" }).tap_action.perform_action, "light.turn_off");
});

// ---- Issue #16: scene, climate_setpoint, media_play_pause, media_next -------------------------------------

const at = (ms) => new Date(Date.now() - ms).toISOString();
const timed = (entity_id, s, attributes, changedMsAgo) => ({
  entity_id,
  state: s,
  attributes,
  last_changed: at(changedMsAgo),
  last_updated: at(changedMsAgo),
});

test("scene: runs the scene, lit while nothing it sets has changed since", () => {
  const scene = timed("scene.lounge_movie", at(600_000), { friendly_name: "Lounge Movie", entity_id: ["light.a", "cover.blind"] }, 600_000);
  const held = room([scene, timed("light.a", "on", {}, 595_000), timed("cover.blind", "closed", {}, 590_000)]);
  const a = held({ preset: "scene", entity: "scene.lounge_movie" });
  assert.equal(a.name, "Movie", "the area prefix is dropped");
  assert.equal(a.active, true);
  assert.deepEqual(a.tap_action, { action: "perform-action", perform_action: "scene.turn_on", target: { entity_id: "scene.lounge_movie" } });
  // Someone dimmed the light five minutes later: the scene no longer holds.
  const touched = room([scene, timed("light.a", "on", {}, 300_000), timed("cover.blind", "closed", {}, 590_000)]);
  assert.equal(touched({ preset: "scene", entity: "scene.lounge_movie" }).active, false);
  // A scene that never ran, and a scene preset without a scene.
  assert.equal(room([state("scene.x", "unknown", { entity_id: ["light.a"] })])({ preset: "scene", entity: "scene.x" }).active, false);
  assert.equal(room([])({ preset: "scene" }).disabled, true);
});

test("climate_setpoint: a fixed temperature, lit while the thermostat is at it", () => {
  const r = room([state("climate.lounge", "heat", { temperature: 21, hvac_action: "idle" })]);
  const a = r({ preset: "climate_setpoint", temperature: 21 });
  assert.equal(a.name, "21°");
  assert.equal(a.active, true);
  // No entity: the whole area's thermostats.
  assert.deepEqual(a.tap_action, { action: "perform-action", perform_action: "climate.set_temperature", target: { area_id: "lounge" }, data: { temperature: 21 } });
  const b = r({ preset: "climate_setpoint", entity: "climate.lounge", temperature: 23.5 });
  assert.equal(b.active, false);
  assert.deepEqual(b.tap_action.target, { entity_id: "climate.lounge" });
  // A thermostat that is off is never "at" a temperature.
  assert.equal(room([state("climate.lounge", "off", { temperature: 21 })])({ preset: "climate_setpoint", temperature: 21 }).active, false);
});

test("climate_setpoint: a step moves the set point, rounded and kept within the thermostat's range", () => {
  const r = room([state("climate.lounge", "heat", { temperature: 21, target_temp_step: 0.5, min_temp: 7, max_temp: 21.5, hvac_action: "heating" })]);
  const up = r({ preset: "climate_setpoint", step: 0.5 });
  assert.equal(up.name, "+0.5°");
  assert.equal(up.icon, "mdi:thermometer-plus");
  assert.equal(up.active, true, "lit while heating");
  assert.deepEqual(up.tap_action, { action: "perform-action", perform_action: "climate.set_temperature", target: { entity_id: "climate.lounge" }, data: { temperature: 21.5 } });
  assert.deepEqual(r({ preset: "climate_setpoint", step: 2 }).tap_action.data, { temperature: 21.5 }, "clamped to max_temp");
  const down = r({ preset: "climate_setpoint", step: -1 });
  assert.equal(down.name, "−1°");
  assert.deepEqual(down.tap_action.data, { temperature: 20 });
  // A heat/cool range moves both ends.
  const range = room([state("climate.lounge", "heat_cool", { target_temp_low: 19, target_temp_high: 24 })]);
  assert.deepEqual(range({ preset: "climate_setpoint", step: 0.5 }).tap_action.data, { target_temp_low: 19.5, target_temp_high: 24.5 });
});

test("climate_setpoint without a value shows the set point and opens the thermostat; no thermostat disables it", () => {
  const a = room([state("climate.lounge", "cool", { temperature: 24.5, hvac_action: "cooling" })])({ preset: "climate_setpoint" });
  assert.equal(a.name, "24.5°");
  assert.equal(a.active, true);
  assert.deepEqual(a.tap_action, { action: "more-info", entity: "climate.lounge" });
  assert.equal(room([state("light.a", "on")])({ preset: "climate_setpoint", step: 1 }).disabled, true);
});

test("media_play_pause: pauses what plays, else resumes the player paused last", () => {
  const playing = room([state("media_player.tv", "playing"), state("media_player.speaker", "paused")]);
  const p = playing({ preset: "media_play_pause" });
  assert.equal(p.name, "Pause");
  assert.equal(p.icon, "mdi:pause");
  assert.equal(p.active, true);
  assert.deepEqual(p.tap_action, { action: "perform-action", perform_action: "media_player.media_pause", target: { entity_id: ["media_player.tv"] } });
  const paused = room([
    timed("media_player.tv", "paused", {}, 60_000),
    timed("media_player.speaker", "paused", {}, 5_000),
    timed("media_player.radio", "idle", {}, 1_000),
  ]);
  const q = paused({ preset: "media_play_pause" });
  assert.equal(q.name, "Play");
  assert.equal(q.active, false);
  assert.deepEqual(q.tap_action, { action: "perform-action", perform_action: "media_player.media_play", target: { entity_id: ["media_player.speaker"] } });
  // Nothing playing or paused: nothing to do. An entity: its own play/pause.
  assert.equal(room([state("media_player.tv", "off")])({ preset: "media_play_pause" }).disabled, true);
  const own = paused({ preset: "media_play_pause", entity: "media_player.tv" });
  assert.deepEqual(own.tap_action, { action: "perform-action", perform_action: "media_player.media_play_pause", target: { entity_id: ["media_player.tv"] } });
});

test("media_next skips on what plays", () => {
  const a = room([state("media_player.tv", "playing"), state("media_player.speaker", "playing")])({ preset: "media_next" });
  assert.equal(a.active, true);
  assert.deepEqual(a.tap_action, {
    action: "perform-action",
    perform_action: "media_player.media_next_track",
    target: { entity_id: ["media_player.tv", "media_player.speaker"] },
  });
  assert.equal(room([])({ preset: "media_next" }).disabled, true);
});

test("with a label filter, the new presets only touch the entities the card shows", () => {
  const hass = {
    states: {
      "climate.lounge": state("climate.lounge", "heat", { temperature: 20 }),
      "climate.hidden": state("climate.hidden", "heat", { temperature: 20 }),
      "media_player.tv": state("media_player.tv", "playing"),
      "media_player.hidden": state("media_player.hidden", "playing"),
    },
    entities: {
      "climate.lounge": { entity_id: "climate.lounge", area_id: "lounge", labels: ["on_card"] },
      "climate.hidden": { entity_id: "climate.hidden", area_id: "lounge" },
      "media_player.tv": { entity_id: "media_player.tv", area_id: "lounge", labels: ["on_card"] },
      "media_player.hidden": { entity_id: "media_player.hidden", area_id: "lounge" },
    },
    devices: {},
    areas: {},
    language: "en",
  };
  const filter = resolveLabelFilter({ include: ["on_card"] });
  const index = indexArea(hass, "lounge", [], filter);
  const groups = buildGroups(hass, {}, index);
  const r = (cfg) => resolveAction(hass, cfg, area, groups, index, true);
  assert.deepEqual(r({ preset: "climate_setpoint", temperature: 21 }).tap_action.target, { entity_id: ["climate.lounge"] });
  assert.deepEqual(r({ preset: "climate_setpoint", step: 1 }).tap_action.target, { entity_id: "climate.lounge" });
  assert.deepEqual(r({ preset: "media_play_pause" }).tap_action.target, { entity_id: ["media_player.tv"] });
  assert.deepEqual(r({ preset: "media_next" }).tap_action.target, { entity_id: ["media_player.tv"] });
});

test("every preset resolves to a name, an icon and an action", () => {
  const r = room([state("light.a", "on")]);
  for (const preset of PRESETS) {
    const a = r({ preset });
    assert.ok(a.name && a.icon && a.tap_action, preset);
  }
});
