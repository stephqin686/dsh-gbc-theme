// Host half of the GBC wallpaper theme.
// The visual work lives entirely in ./client.js; this entry only keeps the
// bundle visible to the DSH loader so the client manifest is discovered.
export const name = 'dsh-gbc-theme';
export const inject = [];
export function apply() {
  // no host-side behaviour
}
