import { errorText } from '#lib/core/errors.ts';
import { listImageFiles, type ImageFolderListing } from '#lib/core/image-file.ts';
import { restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { campaignsByImage } from '#lib/software/image-tree.ts';
import {
  IMAGES_ROOT,
  SOFTWARE_CONFIG,
  parseCampaignConfigs,
  parseImages,
  parseUrlBase
} from '#lib/software/model.ts';

import type { PageLoad } from './$types';

// The image list and the image folder, shown together as one tree, and
// which images the campaigns name, which keeps those from moving. The
// folder is in the URL, ?folder=iosxe/17.18, the top without it.
export const load: PageLoad = async ({ fetch, depends, url }) => {
  depends('data:images');
  const folder = (url.searchParams.get('folder') ?? '').replace(/^\/+|\/+$/g, '');

  // Without the folder or the campaigns the list still shows; a move reads
  // the campaigns again anyway.
  const [list, files, campaigns] = await Promise.all([
    restconfGetOrNull<unknown>(IMAGES_ROOT, fetch).then(
      (json) => ({ json, error: '' }),
      (e: unknown) => ({ json: null, error: errorText(e, 'Failed to load images.') })
    ),
    listImageFiles(fetch).then(
      (listing) => ({ listing, error: '' }),
      (e: unknown) => ({ listing: null as ImageFolderListing | null, error: errorText(e, 'Failed to read the image folder.') })
    ),
    restconfGetCachedOrNull<unknown>(SOFTWARE_CONFIG, fetch).then(
      (json) => campaignsByImage(parseCampaignConfigs(json)),
      () => null
    )
  ]);

  return {
    folder,
    images: parseImages(list.json),
    urlBase: parseUrlBase(list.json),
    listing: files.listing,
    inUse: campaigns,
    loadError: list.error,
    filesError: files.error
  };
};
