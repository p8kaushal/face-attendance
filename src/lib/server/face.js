import fs from 'fs';
import path from 'path';
import https from 'https';
import ort from 'onnxruntime-node';

const MODEL_DIR = path.resolve('models');
const MODEL_PATH = path.join(MODEL_DIR, 'arcface.onnx');
// Pre-trained MobileFaceNet ArcFace ONNX model hosted on Hugging Face (approx. 4MB)
const MODEL_URL = 'https://huggingface.co/antigravity/models/resolve/main/arcface_mobilefacenet.onnx';

let session = null;

// Download helper using native fetch (handles redirects automatically)
async function downloadModel(url, dest) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download model from ${url}. Status code: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  await fs.promises.writeFile(dest, Buffer.from(buffer));
}

export async function initFaceModel() {
  if (session) return session;

  if (!fs.existsSync(MODEL_DIR)) {
    fs.mkdirSync(MODEL_DIR, { recursive: true });
  }

  if (!fs.existsSync(MODEL_PATH)) {
    console.log('Downloading ArcFace ONNX model from Hugging Face...');
    try {
      const fallbackUrl = 'https://huggingface.co/garavv/arcface-onnx/resolve/main/arc.onnx';
      await downloadModel(fallbackUrl, MODEL_PATH);
      console.log('ArcFace model downloaded successfully.');
    } catch (err) {
      console.error('Model download failed:', err);
      throw err;
    }
  }

  // Load ONNX session
  try {
    session = await ort.InferenceSession.create(MODEL_PATH);
    console.log('ArcFace ONNX Inference Session loaded successfully.');
    return session;
  } catch (err) {
    console.error('Failed to load ONNX Inference session:', err);
    throw err;
  }
}

/**
 * Extracts 512-dimensional embedding vector from pre-processed planar face pixel data
 * @param {Array<number>} planarArray - Planar Float32Array values of shape [1, 3, 112, 112]
 * @returns {Promise<Array<number>>} 512-dimensional embedding vector
 */
export async function extractEmbedding(planarArray) {
  if (!session) {
    await initFaceModel();
  }

  try {
    const floatArray = new Float32Array(planarArray);
    const inputName = session.inputNames[0];
    const inputTensor = new ort.Tensor('float32', floatArray, [1, 112, 112, 3]);

    const feeds = { [inputName]: inputTensor };
    const results = await session.run(feeds);

    const outputName = session.outputNames[0];
    const outputTensor = results[outputName];
    
    // Output vector is 512 dimensions
    return Array.from(outputTensor.data);
  } catch (err) {
    console.error('ArcFace inference failed:', err);
    throw err;
  }
}

function l2Normalize(vector) {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) {
    sum += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector;
  const normalized = [];
  for (let i = 0; i < vector.length; i++) {
    normalized.push(vector[i] / norm);
  }
  return normalized;
}

/**
 * Compare two embeddings using L2 normalized Euclidean distance
 * @param {Array<number>} emb1 
 * @param {Array<number>} emb2 
 * @returns {number}
 */
export function getDistance(emb1, emb2) {
  const norm1 = l2Normalize(emb1);
  const norm2 = l2Normalize(emb2);
  let sum = 0;
  for (let i = 0; i < norm1.length; i++) {
    sum += Math.pow(norm1[i] - norm2[i], 2);
  }
  return Math.sqrt(sum);
}
