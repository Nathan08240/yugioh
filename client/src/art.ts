// WebP thumbnails of the artworks (160 and 320 px wide, see server/src/thumbs.ts) for lists; /api/art/<code>.jpg stays for the detail sheet and the 3D board.
export const thumbSmall = (code: number) => `/api/art/${code}-160.webp`;

// For a lazy image of variable size (a card): `sizes="auto"` lets the browser pick the width from the layout and the screen density.
export const thumbSet = (code: number) => ({
  src: `/api/art/${code}-320.webp`,
  srcSet: `/api/art/${code}-160.webp 160w, /api/art/${code}-320.webp 320w`,
  sizes: "auto",
});
