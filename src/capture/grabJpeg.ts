/** Draws the current video frame at a fixed width (DESIGN §4: 1280 px, JPEG quality 0.7). */
export function grabJpeg(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  width = 1280,
  quality = 0.7,
): Promise<Blob | null> {
  if (!video.videoWidth || !video.videoHeight) return Promise.resolve(null);
  canvas.width = width;
  canvas.height = Math.round((video.videoHeight * width) / video.videoWidth);
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}
