// Picking the image each selected device installs: one pick per hardware
// model, from the images that list the model.

import { compareVersions, type CatalogImage } from '#lib/software/images.ts';
import type { Device } from '#lib/software/model.ts';

export interface ModelGroup {
  model: string;
  /** Device names, sorted. */
  devices: string[];
}

/** The devices by model, models sorted. Devices that have not reported a
 * model cannot be matched to an image; they are left out. */
export function modelGroups(devices: Device[]): { groups: ModelGroup[]; leftOut: string[] } {
  const byModel = new Map<string, string[]>();
  const leftOut: string[] = [];
  for (const d of devices) {
    if (!d.model) leftOut.push(d.name);
    else byModel.set(d.model, [...(byModel.get(d.model) ?? []), d.name]);
  }
  const groups = [...byModel.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([model, names]) => ({ model, devices: names.sort() }));
  return { groups, leftOut: leftOut.sort() };
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
 * its model. A pick no image of the model's list has counts as none. */
export function memberImages(
  groups: ModelGroup[],
  picks: Record<string, string>,
  images: CatalogImage[]
): { name: string; image: string }[] {
  const members: { name: string; image: string }[] = [];
  for (const g of groups) {
    const pick = picks[g.model] ?? '';
    const image = imagesFor(g.model, images).some((i) => i.name === pick) ? pick : '';
    for (const name of g.devices) members.push({ name, image });
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

/** The releases a campaign upgrades to: the versions of its members'
 * images, newest first; images not in the list are skipped. */
export function releasesOf(images: string[], catalog: CatalogImage[]): string[] {
  const version = new Map(catalog.map((i) => [i.name, i.version]));
  const releases = new Set<string>();
  for (const image of images) {
    const v = version.get(image);
    if (v) releases.add(v);
  }
  return [...releases].sort((a, b) => compareVersions(b, a));
}
