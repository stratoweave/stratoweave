// Where a device or a campaign opens. A device in a campaign's views opens
// as that campaign shows it; anywhere else it opens its settings.

export function deviceHref(device: string): string {
  return `/devices/${encodeURIComponent(device)}`;
}

export function campaignHref(campaign: string): string {
  return `/campaigns/${encodeURIComponent(campaign)}`;
}

export function campaignDeviceHref(campaign: string, device: string): string {
  return `${campaignHref(campaign)}/devices/${encodeURIComponent(device)}`;
}
