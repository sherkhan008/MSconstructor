import type { ShelvingConfiguration } from '@/lib/types/domain';
import { MAX_WORKSPACE_KITS, MIN_WORKSPACE_KITS } from '@/lib/configurator/limits';
import { readPersistedConfiguration } from '@/lib/configurator/persisted-configuration';
import { getPhysicalKitCount, MAX_KITS_PER_ORDER } from '@/lib/orders/limits';

/**
 * Configurator workspace (V2.5): up to MAX_WORKSPACE_KITS independent kits,
 * one of them active. Each kit owns exactly one ShelvingConfiguration — the
 * unchanged domain model of one physical rack configuration — plus the UI
 * memory of which of ITS sections is active. Nothing workspace-level lives
 * inside ShelvingConfiguration, and no section state exists outside it.
 *
 * Physical racks: a kit's `configuration.quantity` is how many racks of it
 * are ordered, so the workspace counts Σ quantity against the order limit
 * (src/lib/orders/limits.ts) exactly as a cart does. That limit stays
 * server-authoritative; the workspace only mirrors it.
 */
export interface ConfiguratorKit {
  id: string;
  configuration: ShelvingConfiguration;
  /** The kit's own selected section — remembered per kit, never shared. */
  activeSectionId: string;
}

export interface ConfiguratorWorkspace {
  kits: ConfiguratorKit[];
  activeKitId: string;
}

let idCounter = 0;
export function generateWorkspaceId(prefix: 'kit' | 'sec'): string {
  idCounter += 1;
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${idCounter}`;
}

/**
 * A copy of `configuration` whose sections all carry new ids, with every
 * section-scoped accessory re-pointed at its section's new id (by position,
 * so nothing is lost). Used whenever a configuration enters the workspace as
 * a new kit, so section ids never collide across kits.
 */
export function withFreshSectionIds(configuration: ShelvingConfiguration): ShelvingConfiguration {
  const idMap = new Map<string, string>();
  const sections = configuration.sections.map((section) => {
    const id = generateWorkspaceId('sec');
    idMap.set(section.id, id);
    return { ...section, id };
  });
  const accessories = configuration.accessories.map((a) =>
    a.sectionId === undefined ? { ...a } : { ...a, sectionId: idMap.get(a.sectionId) ?? a.sectionId },
  );
  return { ...configuration, sections, accessories };
}

/** A new kit (fresh kit and section ids) for `configuration`; its active
 * section is the one at `activeSectionIndex` when valid, else the first. */
export function createKit(configuration: ShelvingConfiguration, activeSectionIndex = 0): ConfiguratorKit {
  const fresh = withFreshSectionIds(configuration);
  const active = fresh.sections[activeSectionIndex] ?? fresh.sections[0];
  return { id: generateWorkspaceId('kit'), configuration: fresh, activeSectionId: active.id };
}

/** Physical racks the workspace describes: Σ configuration.quantity. */
export function getWorkspaceRackCount(kits: readonly ConfiguratorKit[]): number {
  return getPhysicalKitCount(kits);
}

/** Whether `additional` more racks fit into the workspace (Σ quantity ≤ 5). */
export function canAddWorkspaceRacks(kits: readonly ConfiguratorKit[], additional: number): boolean {
  return getWorkspaceRackCount(kits) + additional <= MAX_KITS_PER_ORDER;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * Reads a persisted current-version (v4) workspace. Browser storage is
 * untrusted: anything that is not exactly the current shape — no kits, more
 * than MAX_WORKSPACE_KITS, a malformed configuration, duplicate kit ids or a
 * section id shared by two kits — returns `undefined` (the caller resets);
 * nothing is guessed or partially kept. An unknown active kit/section id is
 * only a UI pointer and falls back to the first kit/section.
 *
 * Σ quantity is NOT clamped here: a workspace over the physical-rack limit is
 * kept as it was and shown as over the limit (cart and order refuse it), the
 * same policy as a configuration over the section limit.
 */
export function readPersistedWorkspace(raw: unknown): ConfiguratorWorkspace | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.kits)) return undefined;
  if (raw.kits.length < MIN_WORKSPACE_KITS || raw.kits.length > MAX_WORKSPACE_KITS) return undefined;
  const kits: ConfiguratorKit[] = [];
  const kitIds = new Set<string>();
  const sectionIds = new Set<string>();
  for (const rawKit of raw.kits) {
    if (!isRecord(rawKit) || !isNonEmptyString(rawKit.id) || kitIds.has(rawKit.id)) return undefined;
    const configuration = readPersistedConfiguration(rawKit.configuration);
    if (!configuration) return undefined;
    for (const section of configuration.sections) {
      if (sectionIds.has(section.id)) return undefined;
      sectionIds.add(section.id);
    }
    kitIds.add(rawKit.id);
    const activeSectionId = configuration.sections.some((s) => s.id === rawKit.activeSectionId)
      ? (rawKit.activeSectionId as string)
      : configuration.sections[0].id;
    kits.push({ id: rawKit.id, configuration, activeSectionId });
  }
  const activeKitId = kitIds.has(raw.activeKitId as string) ? (raw.activeKitId as string) : kits[0].id;
  return { kits, activeKitId };
}
