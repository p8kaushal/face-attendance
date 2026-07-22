const FaceAPI = {
  modelsLoaded: false,

  async loadModels() {
    const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model';
    try {
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
      ]);
      this.modelsLoaded = true;
      return true;
    } catch (error) {
      console.error('Error loading models:', error);
      return false;
    }
  },

  getFaceDetectorOptions() {
    return new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });
  },

  async detectFace(videoElement) {
    if (!this.modelsLoaded) throw new Error('Models not loaded');
    return faceapi.detectAllFaces(videoElement, this.getFaceDetectorOptions())
      .withFaceLandmarks().withFaceDescriptors();
  },

  async captureFaceDescriptor(videoElement) {
    const detections = await this.detectFace(videoElement);
    if (detections.length === 0) throw new Error('No face detected');
    if (detections.length > 1) throw new Error('Multiple faces detected');
    return detections[0].descriptor;
  },

  findMatchingUser(descriptor, users, threshold = 0.4) {
    let bestMatch = null, bestDistance = Infinity;
    for (const user of users) {
      if (!user.faceDescriptor || user.faceDescriptor.length !== 128) continue;
      const distance = faceapi.euclideanDistance(descriptor, new Float32Array(user.faceDescriptor));
      if (distance < threshold && distance < bestDistance) {
        bestDistance = distance;
        bestMatch = { ...user, distance };
      }
    }
    return bestMatch;
  },

  // Calculate Eye Aspect Ratio (EAR) for blink detection
  getEAR(eyeLandmarks) {
    const p1 = eyeLandmarks[0];
    const p2 = eyeLandmarks[1];
    const p3 = eyeLandmarks[2];
    const p4 = eyeLandmarks[3];
    const p5 = eyeLandmarks[4];
    const p6 = eyeLandmarks[5];

    const dist = (pt1, pt2) => Math.sqrt(Math.pow(pt1.x - pt2.x, 2) + Math.pow(pt1.y - pt2.y, 2));

    const vertical1 = dist(p2, p6);
    const vertical2 = dist(p3, p5);
    const horizontal = dist(p1, p4);

    if (horizontal === 0) return 0.25;
    return (vertical1 + vertical2) / (2.0 * horizontal);
  },

  // Calculate Head Turn (Yaw) Ratio
  getYawRatio(landmarks) {
    const nose = landmarks.getNose()[3]; // Tip of the nose (landmark 30)
    const leftEyeOuter = landmarks.getLeftEye()[0]; // Outer corner of left eye
    const rightEyeOuter = landmarks.getRightEye()[3]; // Outer corner of right eye

    const dist = (pt1, pt2) => Math.sqrt(Math.pow(pt1.x - pt2.x, 2) + Math.pow(pt1.y - pt2.y, 2));

    const leftDist = dist(nose, leftEyeOuter);
    const rightDist = dist(nose, rightEyeOuter);

    if (rightDist === 0) return 1.0;
    return leftDist / rightDist;
  },

  // Detect liveness actions with adaptive thresholds
  detectLiveness(landmarks, history = { earHistory: [], yawHistory: [], blinked: false, headTurned: false }) {
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();

    const leftEAR = this.getEAR(leftEye);
    const rightEAR = this.getEAR(rightEye);
    const avgEAR = (leftEAR + rightEAR) / 2.0;

    const yawRatio = this.getYawRatio(landmarks);

    history.earHistory.push(avgEAR);
    history.yawHistory.push(yawRatio);

    if (history.earHistory.length > 25) history.earHistory.shift();
    if (history.yawHistory.length > 25) history.yawHistory.shift();

    // Adaptive check: find max EAR (fully open eyes) in history window
    const maxEAR = history.earHistory.length > 4 ? Math.max(...history.earHistory) : 0.28;
    
    // Blink matches a 20% drop from the maximum eye open state
    if (history.earHistory.length > 4 && avgEAR < 0.82 * maxEAR && !history.blinked) {
      history.blinked = true;
    }

    if ((yawRatio < 0.65 || yawRatio > 1.5) && !history.headTurned) {
      history.headTurned = true;
    }

    return {
      blinked: history.blinked,
      headTurned: history.headTurned,
      avgEAR,
      maxEAR,
      yawRatio
    };
  },

  drawFaceBox(canvas, detection, color = '#2563eb') {
    const ctx = canvas.getContext('2d');
    const { x, y, width, height } = detection.detection.box;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 8);
    ctx.stroke();
  },

  clearCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
};
