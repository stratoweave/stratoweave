// Picking the image each selected device installs: one pick per hardware
// model, from the images that list the model.

import { compareVersions, type CatalogImage } from '#lib/software/images.ts';
import type { Device } from '#lib/software/model.ts';

export interface ModelDevice {
  name: string;
  /** The release it last reported; '' when it has not. */
  version: string;
}

export interface ModelGroup {
  model: string;
  /** Sorted by name. */
  devices: ModelDevice[];
}

/** The devices by model, models sorted. Devices that have not reported a
 * model cannot be matched to an image; they are left out. */
export function modelGroups(devices: Device[]): { groups: ModelGroup[]; leftOut: string[] } {
  const byModel = new Map<string, ModelDevice[]>();
  const leftOut: string[] = [];
  for (const d of devices) {
    if (!d.model) {
      leftOut.push(d.name);
      continue;
    }
    const entry = { name: d.name, version: d.version };
    const list = byModel.get(d.model);
    if (list) list.push(entry);
    else byModel.set(d.model, [entry]);
  }
  const groups = [...byModel.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([model, list]) => ({ model, devices: list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) }));
  return { groups, leftOut: leftOut.sort() };
}

/** Where the devices of a model stand against an image's release, from
 * the release each last reported: the device itself decides when the
 * campaign reads it. A device that has not reported one needs it. */
export interface TargetSplit {
  need: string[];
  onTarget: string[];
  /** Run a newer release: the campaign would downgrade them. */
  newer: string[];
}

export function targetSplit(devices: ModelDevice[], version: string): TargetSplit {
  const split: TargetSplit = { need: [], onTarget: [], newer: [] };
  for (const d of devices) {
    const order = d.version && version ? compareVersions(d.version, version) : -1;
    if (order === 0) split.onTarget.push(d.name);
    else if (order > 0) split.newer.push(d.name);
    else split.need.push(d.name);
  }
  return split;
}

/** Which devices to leave out of the campaign. */
export interface LeaveOut {
  /** The devices that already run their image. */
  onTarget: boolean;
  /** The devices that run a newer release than their image. */
  newer: boolean;
}

/** The image picked for model, '' for none: a pick that no image of the
 * model's list has counts as none. */
function pickFor(model: string, picks: Record<string, string>, images: CatalogImage[]): CatalogImage | null {
  const pick = picks[model] ?? '';
  return imagesFor(model, images).find((i) => i.name === pick) ?? null;
}

/** How many of the grouped devices already run their picked image, and
 * how many run a newer release. */
export function targetCounts(
  groups: ModelGroup[],
  picks: Record<string, string>,
  images: CatalogImage[]
): { onTarget: number; newer: number } {
  let onTarget = 0;
  let newer = 0;
  for (const g of groups) {
    const image = pickFor(g.model, picks, images);
    if (image === null) continue;
    const split = targetSplit(g.devices, image.version);
    onTarget += split.onTarget.length;
    newer += split.newer.length;
  }
  return { onTarget, newer };
}

/** The images that list model, by family, newest version first. */
export function imagesFor(model: string, images: CatalogImage[]): CatalogImage[] {
  return images
    .filter((i) => i.models.includes(model))
    .sort(
      (a, b) =>
        a.family.localeCompare(b.family) || compareVersions(b.version, a.version) || a.name.localeCompare(b.name)
    );
}

/** The image a model starts with: the default image that lists it, when
 * exactly one does; '' otherwise. */
export function preselected(model: string, images: CatalogImage[]): string {
  const defaults = imagesFor(model, images).filter((i) => i.isDefault);
  return defaults.length === 1 ? defaults[0].name : '';
}

/** Picks for the models that have none yet, from their defaults; the
 * picks made before stay. */
export function withPreselected(
  groups: ModelGroup[],
  picks: Record<string, string>,
  images: CatalogImage[]
): Record<string, string> {
  const next = { ...picks };
  for (const g of groups) {
    if (!(g.model in next)) next[g.model] = preselected(g.model, images);
  }
  return next;
}

/** The campaign members: each grouped device with the image picked for
 * its model, without the devices that leaveOut leaves out. A pick no image
 * of the model's list has counts as none. */
export function memberImages(
  groups: ModelGroup[],
  picks: Record<string, string>,
  images: CatalogImage[],
  leaveOut: LeaveOut = { onTarget: false, newer: false }
): { name: string; image: string }[] {
  const members: { name: string; image: string }[] = [];
  for (const g of groups) {
    const image = pickFor(g.model, picks, images);
    let names = g.devices.map((d) => d.name);
    if (image !== null && (leaveOut.onTarget || leaveOut.newer)) {
      const split = targetSplit(g.devices, image.version);
      const out = new Set([...(leaveOut.onTarget ? split.onTarget : []), ...(leaveOut.newer ? split.newer : [])]);
      names = names.filter((n) => !out.has(n));
    }
    for (const name of names) members.push({ name, image: image?.name ?? '' });
  }
  return members.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The distinct images of a campaign's members and how many install each,
 * most first. */
export function imageCounts(images: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const image of images) counts.set(image, (counts.get(image) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
