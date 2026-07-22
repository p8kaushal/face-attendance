import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision';

let faceDetector = null;
let vision = null;

export async function initMediaPipe() {
  if (faceDetector) return faceDetector;

  try {
    vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
    );
    
    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`,
        delegate: "GPU"
      },
      runningMode: "VIDEO"
    });
    console.log('Google MediaPipe FaceDetector initialized.');
    return faceDetector;
  } catch (err) {
    console.error('Failed to initialize Google MediaPipe:', err);
    throw err;
  }
}

/**
 * Detect faces in a video frame
 * @param {HTMLVideoElement} videoElement 
 * @returns {Promise<Array<any>>}
 */
export async function detectFaces(videoElement) {
  if (!faceDetector) {
    await initMediaPipe();
  }
  
  const timestamp = performance.now();
  const result = faceDetector.detectForVideo(videoElement, timestamp);
  return result.detections || [];
}

/**
 * Crops a detected face, resizes it to 112x112, and returns normalized planar float array
 * @param {HTMLVideoElement} videoElement 
 * @param {any} boundingBox - { originX, originY, width, height }
 * @returns {Float32Array}
 */
export function getPlanarFacePixels(videoElement, boundingBox) {
  const canvas = document.createElement('canvas');
  canvas.width = 112;
  canvas.height = 112;
  const ctx = canvas.getContext('2d');

  const paddingX = boundingBox.width * 0.15;
  const paddingY = boundingBox.height * 0.15;
  
  const sx = Math.max(0, boundingBox.originX - paddingX);
  const sy = Math.max(0, boundingBox.originY - paddingY);
  const sWidth = Math.min(videoElement.videoWidth - sx, boundingBox.width + paddingX * 2);
  const sHeight = Math.min(videoElement.videoHeight - sy, boundingBox.height + paddingY * 2);

  ctx.drawImage(videoElement, sx, sy, sWidth, sHeight, 0, 0, 112, 112);

  const imgData = ctx.getImageData(0, 0, 112, 112);
  const data = imgData.data;

  // Output channels-last Float32Array: shape [112, 112, 3]
  const pixels = new Float32Array(112 * 112 * 3);

  for (let i = 0; i < 112 * 112; i++) {
    pixels[i * 3] = (data[i * 4] - 127.5) / 128.0;     // R
    pixels[i * 3 + 1] = (data[i * 4 + 1] - 127.5) / 128.0; // G
    pixels[i * 3 + 2] = (data[i * 4 + 2] - 127.5) / 128.0; // B
  }

  return pixels;
}

/**
 * Render bounding boxes onto canvas overlay
 * @param {HTMLCanvasElement} canvas 
 * @param {any} boundingBox 
 * @param {string} color 
 */
export function drawFaceBox(canvas, boundingBox, color = '#3b82f6') {
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(
    boundingBox.originX,
    boundingBox.originY,
    boundingBox.width,
    boundingBox.height
  );
}
