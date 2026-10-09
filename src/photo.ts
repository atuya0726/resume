export interface ResumePhoto {
  dataUrl: string;
  width: number;
  height: number;
  zoom: number;
  x: number;
  y: number;
}

export function parsePhoto(value: unknown): ResumePhoto | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('写真の形式を確認してください。');
  const photo = value as Record<string, unknown>;
  if (typeof photo.dataUrl !== 'string' || photo.dataUrl.length > 600_000 ||
      !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(photo.dataUrl) || (photo.dataUrl.length - 23) % 4 !== 0 ||
      ![photo.width, photo.height].every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 1600) ||
      typeof photo.zoom !== 'number' || !Number.isFinite(photo.zoom) || photo.zoom < 1 || photo.zoom > 4 ||
      ![photo.x, photo.y].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) {
    throw new Error('写真の形式・サイズ・切り取り位置を確認してください。');
  }
  return { dataUrl: photo.dataUrl, width: photo.width as number, height: photo.height as number,
    zoom: photo.zoom, x: photo.x as number, y: photo.y as number };
}

// A fixed 3:4 viewport. Coordinates represent a fraction of the available pan distance.
export function photoCrop(photo: Pick<ResumePhoto, 'width' | 'height' | 'zoom' | 'x' | 'y'>) {
  const scale = Math.max(3 / photo.width, 4 / photo.height) * photo.zoom;
  const width = 3 / scale;
  const height = 4 / scale;
  return { x: (photo.width - width) * photo.x, y: (photo.height - height) * photo.y, width, height };
}

export function photoStyle(photo: ResumePhoto): string {
  const crop = photoCrop(photo);
  return `width:${photo.width / crop.width * 100}%;height:${photo.height / crop.height * 100}%;left:${-crop.x / crop.width * 100}%;top:${-crop.y / crop.height * 100}%;`;
}
