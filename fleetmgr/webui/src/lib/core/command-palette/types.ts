export interface PaletteEntry {
  id: string;
  label: string;
  description?: string;
  href: string;
  /** The "show all" row under a group that has more matches than it shows. */
  more?: boolean;
}

export interface PaletteGroup {
  category: string;
  entries: PaletteEntry[];
}
