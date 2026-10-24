import type { ActionConfig, AreaRegistryEntry, HassEntity, HomeAssistant, PresetId, QuickActionConfig } from "./types";
import type { Group, AreaIndex } from "./discovery";
import { localize } from "./localize";

export const PRESETS: PresetId[] = [
  "lights_toggle",
  "lights_on",
  "lights_off",
  "covers_open",
  "covers_close",
  "fans_off",
  "media_stop",
  "vacuum_area",
  "everything_off",
  "scene",
  "climate_setpoint",
  "media_play_pause",
  "media_next",
];

export interface ResolvedAction {
  name: string;
  icon: string;
  active: boolean;
  color: string;
  disabled: boolean;
  tap_action: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
  entity?: string;
}

const TOGGLE_ON_STATES = new Set(["on", "open", "opening", "playing", "unlocked", "cleaning", "heat", "cool", "auto", "heat_cool", "dry", "fan_only"]);

function areaAction(service: string, areaId: string, extra: Partial<ActionConfig> = {}): ActionConfig {
  return { action: "perform-action", perform_action: service, target: { area_id: areaId }, ...extra };
}

/** Domains `everything_off` switches off when a label filter narrows it to specific entities. */
const OFF_DOMAINS = new Set(["light", "switch", "fan", "media_player", "input_boolean", "climate"]);

/** Default action for a plain entity button. */
function entityDefaultAction(entity: string): ActionConfig {
  const domain = entity.split(".")[0];
  if (domain === "scene" || domain === "script") {
    return { action: "perform-action", perform_action: `${domain}.turn_on`, target: { entity_id: entity } };
  }
  if (domain === "button" || domain === "input_button") {
    return { action: "perform-action", perform_action: `${domain}.press`, target: { entity_id: entity } };
  }
  if (domain === "vacuum") {
    return { action: "more-info", entity };
  }
  return { action: "toggle", entity };
}

const DEFAULT_ICONS: Record<string, string> = {
  light: "mdi:lightbulb",
  switch: "mdi:toggle-switch-variant",
  fan: "mdi:fan",
  cover: "mdi:window-shutter",
  scene: "mdi:palette",
  script: "mdi:script-text-play",
  media_player: "mdi:speaker",
  vacuum: "mdi:robot-vacuum",
  climate: "mdi:thermostat",
  lock: "mdi:lock",
  button: "mdi:gesture-tap-button",
};

export function resolveAction(
  hass: HomeAssistant,
  cfg: QuickActionConfig,
  area: AreaRegistryEntry,
  groups: Partial<Record<string, Group>>,
  index: AreaIndex,
  /**
   * True when a label filter is active. The area presets then target only the entities the card
   * shows, so "Lights off" never switches off lights the user chose to keep off the card.
   */
  filtered = false
): ResolvedAction {
  const areaName = area.name;
  // A service on the whole area, or, with a label filter, on the group's entities only.
  const scoped = (service: string, groupId: string, extra: Partial<ActionConfig> = {}): ActionConfig =>
    filtered
      ? {
          action: "perform-action",
          perform_action: service,
          target: { entity_id: [...(groups[groupId]?.entities ?? [])] },
          ...extra,
        }
      : areaAction(service, area.area_id, extra);
  // An area preset is lit while what it acts on is on (any light on, any cover open), whichever way it
  // acts: the colour says "lights are on here", like the chip. `everything_off` stays unlit.
  const lightsOn = (groups.lights?.active.length ?? 0) > 0;
  const coversOpen = (groups.covers?.active.length ?? 0) > 0;
  const stateObj = cfg.entity ? hass.states[cfg.entity] : undefined;
  let base: Omit<ResolvedAction, "hold_action" | "double_tap_action">;

  switch (cfg.preset) {
    case "lights_toggle":
      base = {
        name: localize(hass, "preset_lights_toggle"),
        icon: lightsOn ? "mdi:lightbulb-group" : "mdi:lightbulb-group-off-outline",
        active: lightsOn,
        color: "var(--apc-amber)",
        disabled: !groups.lights,
        tap_action: scoped(lightsOn ? "light.turn_off" : "light.turn_on", "lights"),
      };
      break;
    case "lights_on":
      base = {
        name: localize(hass, "preset_lights_on"),
        icon: "mdi:lightbulb-on-outline",
        active: lightsOn,
        color: "var(--apc-amber)",
        disabled: !groups.lights,
        tap_action: scoped("light.turn_on", "lights"),
      };
      break;
    case "lights_off":
      base = {
        name: localize(hass, "preset_lights_off"),
        icon: "mdi:lightbulb-off-outline",
        active: lightsOn,
        color: "var(--apc-amber)",
        disabled: !groups.lights,
        tap_action: scoped("light.turn_off", "lights"),
      };
      break;
    case "covers_open":
      base = {
        name: localize(hass, "preset_covers_open"),
        icon: "mdi:window-shutter-open",
        active: coversOpen,
        color: "var(--apc-purple)",
        disabled: !groups.covers,
        tap_action: scoped("cover.open_cover", "covers"),
      };
      break;
    case "covers_close":
      base = {
        name: localize(hass, "preset_covers_close"),
        icon: "mdi:window-shutter",
        active: coversOpen,
        color: "var(--apc-purple)",
        disabled: !groups.covers,
        tap_action: scoped("cover.close_cover", "covers"),
      };
      break;
    case "fans_off":
      base = {
        name: localize(hass, "preset_fans_off"),
        icon: "mdi:fan-off",
        active: (groups.fans?.active.length ?? 0) > 0,
        color: "var(--apc-cyan)",
        disabled: !groups.fans,
        tap_action: scoped("fan.turn_off", "fans"),
      };
      break;
    case "media_stop":
      base = {
        name: localize(hass, "preset_media_stop"),
        icon: "mdi:stop-circle-outline",
        active: (groups.media?.active.length ?? 0) > 0,
        color: "var(--apc-indigo)",
        disabled: !groups.media,
        tap_action: scoped("media_player.media_stop", "media"),
      };
      break;
    case "vacuum_area": {
      const cleaning = stateObj?.state === "cleaning";
      base = {
        name: localize(hass, "preset_vacuum_area"),
        icon: cleaning ? "mdi:robot-vacuum-variant" : "mdi:robot-vacuum",
        active: cleaning,
        color: "var(--apc-teal)",
        disabled: !cfg.entity,
        tap_action: {
          action: "perform-action",
          perform_action: "vacuum.clean_area",
          target: { entity_id: cfg.entity },
          data: { cleaning_area_id: [area.area_id] },
          confirmation: { text: localize(hass, "confirm_vacuum", { area: areaName }) },
        },
      };
      break;
    }
    case "everything_off":
      base = {
        name: localize(hass, "preset_everything_off"),
        icon: "mdi:power",
        active: false,
        color: "var(--apc-red)",
        disabled: false,
        tap_action: {
          ...(filtered
            ? {
                action: "perform-action" as const,
                perform_action: "homeassistant.turn_off",
                target: { entity_id: index.primary.filter((id) => OFF_DOMAINS.has(id.split(".")[0])) },
              }
            : areaAction("homeassistant.turn_off", area.area_id)),
          confirmation: { text: localize(hass, "confirm_everything_off", { area: areaName }) },
        },
      };
      break;
    case "scene": {
      const holds = !!stateObj && sceneHolds(hass, stateObj);
      base = {
        name: entityName(stateObj, cfg.entity, areaName) || localize(hass, "preset_scene"),
        icon: (stateObj?.attributes.icon as string | undefined) || "mdi:palette",
        active: holds,
        color: "var(--apc-accent)",
        disabled: !stateObj || stateObj.state === "unavailable",
        tap_action: cfg.entity
          ? { action: "perform-action", perform_action: "scene.turn_on", target: { entity_id: cfg.entity } }
          : { action: "none" },
      };
      break;
    }
    case "climate_setpoint": {
      base = climateSetpoint(hass, cfg, index, groups, scoped);
      break;
    }
    case "media_play_pause": {
      const t = mediaTargets(hass, cfg, groups);
      base = {
        name: localize(hass, t.playing ? "preset_media_pause" : "preset_media_play"),
        icon: t.playing ? "mdi:pause" : "mdi:play",
        active: t.playing,
        color: "var(--apc-indigo)",
        disabled: !t.targets.length,
        tap_action: t.targets.length
          ? {
              action: "perform-action",
              perform_action: cfg.entity ? "media_player.media_play_pause" : t.playing ? "media_player.media_pause" : "media_player.media_play",
              target: { entity_id: t.targets },
            }
          : { action: "none" },
      };
      break;
    }
    case "media_next": {
      const t = mediaTargets(hass, cfg, groups);
      base = {
        name: localize(hass, "preset_media_next"),
        icon: "mdi:skip-next",
        active: t.playing,
        color: "var(--apc-indigo)",
        disabled: !t.targets.length,
        tap_action: t.targets.length
          ? { action: "perform-action", perform_action: "media_player.media_next_track", target: { entity_id: t.targets } }
          : { action: "none" },
      };
      break;
    }
    default: {
      const domain = cfg.entity?.split(".")[0] ?? "";
      base = {
        name: entityName(stateObj, cfg.entity, areaName) || "Action",
        icon: (stateObj?.attributes.icon as string | undefined) || DEFAULT_ICONS[domain] || "mdi:gesture-tap",
        active: !!stateObj && TOGGLE_ON_STATES.has(stateObj.state),
        color: "var(--apc-accent)",
        disabled: !!cfg.entity && (!stateObj || stateObj.state === "unavailable"),
        tap_action: cfg.entity ? entityDefaultAction(cfg.entity) : { action: "none" },
      };
    }
  }

  return {
    ...base,
    name: cfg.name ?? base.name,
    icon: cfg.icon ?? base.icon,
    color: cfg.color ? cssColor(cfg.color) : base.color,
    tap_action: cfg.tap_action ?? base.tap_action,
    hold_action: cfg.hold_action ?? (cfg.entity ? { action: "more-info", entity: cfg.entity } : undefined),
    double_tap_action: cfg.double_tap_action,
    entity: cfg.entity,
  };
}

/** An entity's name for a button: its friendly name without the area in front, else its ID. */
function entityName(s: HassEntity | undefined, entity: string | undefined, areaName: string): string {
  return (
    (s?.attributes.friendly_name as string | undefined)?.replace(new RegExp(`^${escapeRe(areaName)}\\s*`, "i"), "") ||
    entity ||
    ""
  );
}

/** How long a scene's entities may take to settle after it ran before a change counts as "touched". */
const SCENE_SETTLE_MS = 15_000;
/** Domains whose attributes change when someone adjusts them (dimming, moving a blind), not only their state. */
const ATTRIBUTE_DOMAINS = new Set(["light", "cover", "fan", "climate", "media_player"]);

/**
 * A scene still holds while nothing it sets has changed since it ran (and settled). The same rule as Scene
 * Pulse Card's `untouchedSince` (a card never imports another card's code: change them together).
 */
export function sceneHolds(hass: HomeAssistant, s: HassEntity, settleMs = SCENE_SETTLE_MS): boolean {
  const ran = Date.parse(s.state);
  if (Number.isNaN(ran)) return false;
  const members = Array.isArray(s.attributes.entity_id) ? (s.attributes.entity_id as string[]) : [];
  if (!members.length) return false;
  return members.every((id) => {
    const m = hass.states[id];
    if (!m || m.state === "unavailable") return false;
    const changed = Date.parse(ATTRIBUTE_DOMAINS.has(id.split(".")[0]) ? m.last_updated : m.last_changed);
    return Number.isNaN(changed) || changed <= ran + settleMs;
  });
}

/**
 * The players a media preset acts on: its `entity`, or the area's players that are playing, or else the
 * one paused most recently (so "play" resumes what you paused, not every speaker in the room).
 */
export function mediaTargets(
  hass: HomeAssistant,
  cfg: QuickActionConfig,
  groups: Partial<Record<string, Group>>
): { targets: string[]; playing: boolean } {
  if (cfg.entity) {
    const s = hass.states[cfg.entity];
    const ok = !!s && s.state !== "unavailable";
    return { targets: ok ? [cfg.entity] : [], playing: s?.state === "playing" };
  }
  const media = groups.media;
  if (!media) return { targets: [], playing: false };
  if (media.active.length) return { targets: [...media.active], playing: true };
  const paused = media.entities
    .filter((id) => hass.states[id]?.state === "paused")
    .sort((a, b) => Date.parse(hass.states[b].last_changed) - Date.parse(hass.states[a].last_changed));
  return { targets: paused.slice(0, 1), playing: false };
}

const HEATING = new Set(["heating", "cooling", "drying", "fan"]);

/** A number for the button: "21°", "21.5°", "+0.5°", "−1°". */
function degrees(n: number, signed = false): string {
  const v = Math.round(n * 10) / 10;
  const text = `${Math.abs(v)}°`;
  return signed ? `${v < 0 ? "−" : "+"}${text}` : `${v < 0 ? "−" : ""}${text}`;
}

/**
 * `climate_setpoint`: with `temperature`, set that value (lit while the thermostat is at it); with `step`,
 * move the current set point up or down (both ends of a heat/cool range); with neither, show the set point
 * and open the thermostat. Targets `entity`, else the area's thermostats (the first one for a step).
 */
export function climateSetpoint(
  hass: HomeAssistant,
  cfg: QuickActionConfig,
  index: AreaIndex,
  groups: Partial<Record<string, Group>>,
  scoped: (service: string, groupId: string, extra?: Partial<ActionConfig>) => ActionConfig
): Omit<ResolvedAction, "hold_action" | "double_tap_action"> {
  const area = groups.climate?.entities ?? index.primary.filter((id) => id.startsWith("climate."));
  const targets = cfg.entity ? [cfg.entity] : area;
  const states = targets.map((id) => hass.states[id]).filter((s): s is HassEntity => !!s && s.state !== "unavailable");
  const main = states[0];
  const heating = states.some((s) => HEATING.has(String(s.attributes.hvac_action ?? "")));
  const common = { color: "var(--apc-orange)", disabled: !main };
  const temperature = typeof cfg.temperature === "number" && Number.isFinite(cfg.temperature) ? cfg.temperature : undefined;
  const step = typeof cfg.step === "number" && Number.isFinite(cfg.step) && cfg.step !== 0 ? cfg.step : undefined;

  if (temperature !== undefined) {
    const data = { temperature };
    return {
      ...common,
      name: degrees(temperature),
      icon: "mdi:thermometer",
      active: states.length > 0 && states.every((s) => s.state !== "off" && s.attributes.temperature === temperature),
      tap_action: cfg.entity
        ? { action: "perform-action", perform_action: "climate.set_temperature", target: { entity_id: cfg.entity }, data }
        : scoped("climate.set_temperature", "climate", { data }),
    };
  }

  const attr = (s: HassEntity | undefined, k: string) => {
    const v = s?.attributes[k];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  if (step !== undefined) {
    const target = attr(main, "temperature");
    const low = attr(main, "target_temp_low");
    const high = attr(main, "target_temp_high");
    const unitStep = attr(main, "target_temp_step") ?? (Math.abs(step) >= 1 ? 1 : 0.5);
    const min = attr(main, "min_temp") ?? -Infinity;
    const max = attr(main, "max_temp") ?? Infinity;
    const move = (v: number) => {
      const next = Math.round((v + step) / unitStep) * unitStep;
      return Math.round(Math.min(max, Math.max(min, next)) * 100) / 100;
    };
    const data =
      target !== undefined
        ? { temperature: move(target) }
        : low !== undefined && high !== undefined
        ? { target_temp_low: move(low), target_temp_high: move(high) }
        : undefined;
    return {
      ...common,
      name: degrees(step, true),
      icon: step > 0 ? "mdi:thermometer-plus" : "mdi:thermometer-minus",
      active: heating,
      disabled: !main || !data,
      tap_action: main && data
        ? { action: "perform-action", perform_action: "climate.set_temperature", target: { entity_id: main.entity_id }, data }
        : { action: "none" },
    };
  }

  const target = attr(main, "temperature");
  return {
    ...common,
    name: target !== undefined ? degrees(target) : localize(hass, "preset_climate_setpoint"),
    icon: "mdi:thermostat",
    active: heating,
    tap_action: main ? { action: "more-info", entity: main.entity_id } : { action: "none" },
  };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Icon colour of a quick action, following the tile rule with `chip_colors: state` (calm): an active action
 * (lights on, media playing, vacuum cleaning) colours its icon, an idle or stateless one (lights_on,
 * lights_off, everything_off, a scene) uses the secondary text colour. `category` keeps the colour always.
 */
export function actionIconColor(a: Pick<ResolvedAction, "active" | "color">, calm: boolean): string {
  return !calm || a.active ? a.color : "var(--secondary-text-color)";
}

/** Accept HA colour tokens ("amber", "light-blue") or any CSS colour. */
export function cssColor(color: string): string {
  if (/^(#|rgb|hsl|var\()/i.test(color)) return color;
  if (color === "primary" || color === "accent") return `var(--${color}-color)`;
  return `var(--${color}-color, ${color})`;
}
