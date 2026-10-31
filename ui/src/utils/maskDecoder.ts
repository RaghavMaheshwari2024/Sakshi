/**
 * Decodes COCO run-length encoding (RLE) to a local canvas or binary pixel buffer.
 * Matches sakshi/masks.py decoding logic.
 */

function countsFromString(s: string): number[] {
  const counts: number[] = [];
  let p = 0;
  while (p < s.length) {
    let x = 0;
    let k = 0;
    let more = true;
    while (more) {
      const c = s.charCodeAt(p) - 48;
      x |= (c & 0x1f) << (5 * k);
      more = (c & 0x20) !== 0;
      p++;
      k++;
      if (!more && (c & 0x10) !== 0) {
        x |= -1 << (5 * k);
      }
    }
    if (counts.length > 2) {
      x += counts[counts.length - 2];
    }
    counts.push(x);
  }
  return counts;
}

export function drawRleMask(
  ctx: CanvasRenderingContext2D,
  rle: { size: [number, number]; counts: string | number[] },
  box: [number, number, number, number], // [x0, y0, x1, y1] in video pixel coords
  color: string, // rgba string
  scaleX: number = 1,
  scaleY: number = 1
): void {
  const [h, w] = rle.size;
  const counts = typeof rle.counts === 'string' ? countsFromString(rle.counts) : rle.counts;
  const [x0, y0, x1, y1] = box;
  const targetW = Math.max(1, Math.round(x1 - x0));
  const targetH = Math.max(1, Math.round(y1 - y0));

  // Build offscreen image data for the mask
  const imgData = ctx.createImageData(w, h);
  const data = imgData.data;

  // Parse color hex/rgb
  let r = 6, g = 182, b = 212; // default cyan
  if (color.includes('#')) {
    const hex = color.replace('#', '');
    r = parseInt(hex.substring(0, 2), 16) || 0;
    g = parseInt(hex.substring(2, 4), 16) || 0;
    b = parseInt(hex.substring(4, 6), 16) || 0;
  }

  let pos = 0;
  let val = 0;

  // COCO masks are stored column by column: flat[x * h + y]
  for (let idx = 0; idx < counts.length; idx++) {
    const run = counts[idx];
    if (val === 1) {
      for (let k = 0; k < run; k++) {
        const cur = pos + k;
        const col = Math.floor(cur / h);
        const row = cur % h;
        const pixelIdx = (row * w + col) * 4;
        data[pixelIdx] = r;
        data[pixelIdx + 1] = g;
        data[pixelIdx + 2] = b;
        data[pixelIdx + 3] = 100; // Semi-transparent overlay (~40%)
      }
    }
    pos += run;
    val ^= 1;
  }

  // Draw offscreen onto an in-memory canvas, then stretch to bounding box
  const offscreen = document.createElement('canvas');
  offscreen.width = w;
  offscreen.height = h;
  const offCtx = offscreen.getContext('2d');
  if (!offCtx) return;

  offCtx.putImageData(imgData, 0, 0);

  ctx.drawImage(
    offscreen,
    x0 * scaleX,
    y0 * scaleY,
    targetW * scaleX,
    targetH * scaleY
  );
}
