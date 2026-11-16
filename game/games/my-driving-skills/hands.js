import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const WRIST = 0;
const TIPS = [4, 8, 12, 16, 20];
const PIPS = [3, 6, 10, 14, 18];
const PALM = [0, 5, 9, 13, 17];

const STEER_MAX_ANGLE = 0.6;
const STEER_DEADZONE  = 0.045;
const STEER_TAU       = 0.075;
const THROTTLE_TAU    = 0.16;
const GRIP_LOW        = 0.25;
const GRIP_SPAN       = 0.6;
const BRAKE_ON_Y      = 0.26;
const BRAKE_OFF_Y     = 0.33;
const HANDS_GRACE     = 0.18;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp11 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

export class HandController {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.lastDetectTs = -1;
    this.results = null;

    this.steer = 0;
    this.throttle = 0;
    this.handsOn = false;
    this.brake = false;

    this.lastTs = -1;
    this.lastTwoHandsTs = -1e9;
  }

  async init() {
    const vision = await FilesetResolver.forVisionTasks(WASM);
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  async startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = stream;
    await new Promise((res) => (this.video.onloadedmetadata = res));
    await this.video.play();
  }

  resetTiming() {
    this.lastTs = -1;
    this.lastVideoTime = -1;
  }

  _palmCenter(lm) {
    let x = 0, y = 0;
    for (const i of PALM) { x += lm[i].x; y += lm[i].y; }
    return { x: 1 - x / PALM.length, y: y / PALM.length };
  }

  _grip(lm) {
    const dx = lm[9].x - lm[0].x, dy = lm[9].y - lm[0].y;
    const size = Math.hypot(dx, dy) || 1e-3;
    let extended = 0;
    for (let f = 1; f < 5; f++) {
      const tip = lm[TIPS[f]], pip = lm[PIPS[f]];
      const dTip = Math.hypot(tip.x - lm[0].x, tip.y - lm[0].y);
      const dPip = Math.hypot(pip.x - lm[0].x, pip.y - lm[0].y);
      if (dTip > dPip + size * 0.15) extended++;
    }
    return 1 - extended / 4;
  }

  _applyDeadzone(v) {
    const a = Math.abs(v);
    if (a < STEER_DEADZONE) return 0;
    const sign = v < 0 ? -1 : 1;
    return sign * (a - STEER_DEADZONE) / (1 - STEER_DEADZONE);
  }

  read(ts) {
    const dt = this.lastTs < 0 ? 0.016 : Math.min(0.1, Math.max(0, (ts - this.lastTs) / 1000));
    this.lastTs = ts;

    if (!this.landmarker || this.video.readyState < 2) return this._state();

    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      const stamp = ts <= this.lastDetectTs ? this.lastDetectTs + 1 : ts;
      this.lastDetectTs = stamp;
      try {
        this.results = this.landmarker.detectForVideo(this.video, stamp);
      } catch (_) {
      }
    }

    const lms = this.results?.landmarks ?? [];
    const twoHandsNow = lms.length >= 2;
    if (twoHandsNow) this.lastTwoHandsTs = ts;
    const handsOn = twoHandsNow || (ts - this.lastTwoHandsTs) < HANDS_GRACE * 1000;

    let targetSteer = this.steer;
    let targetThrottle = 0;
    let brake = this.brake;

    if (twoHandsNow) {
      const a = this._palmCenter(lms[0]);
      const b = this._palmCenter(lms[1]);
      const left = a.x <= b.x ? a : b;
      const right = a.x <= b.x ? b : a;

      const angle = Math.atan2(right.y - left.y, right.x - left.x);
      targetSteer = this._applyDeadzone(clamp11(angle / STEER_MAX_ANGLE));

      const grip = (this._grip(lms[0]) + this._grip(lms[1])) / 2;
      targetThrottle = clamp01((grip - GRIP_LOW) / GRIP_SPAN);

      const avgY = (left.y + right.y) / 2;
      if (!brake && avgY < BRAKE_ON_Y) brake = true;
      else if (brake && avgY > BRAKE_OFF_Y) brake = false;
      if (brake) targetThrottle = 0;
    } else {
      targetSteer = this.steer * 0.9;
      brake = false;
    }

    const aSteer = 1 - Math.exp(-dt / STEER_TAU);
    const aThrottle = 1 - Math.exp(-dt / THROTTLE_TAU);
    this.steer    += (targetSteer    - this.steer)    * aSteer;
    this.throttle += (targetThrottle - this.throttle) * aThrottle;
    if (Math.abs(this.steer) < 1e-3) this.steer = 0;
    this.handsOn = handsOn;
    this.brake = handsOn ? brake : false;
    return this._state();
  }

  _state() {
    return {
      steer: this.steer,
      throttle: this.throttle,
      handsOn: this.handsOn,
      brake: this.brake,
      hands: this.results?.landmarks ?? [],
    };
  }

  drawOverlay(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const lms = this.results?.landmarks ?? [];
    if (!lms.length) return;

    const conn = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [5,9],[9,10],[10,11],[11,12],
      [9,13],[13,14],[14,15],[15,16],
      [13,17],[17,18],[18,19],[19,20],[0,17],
    ];
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const lm of lms) {
      ctx.strokeStyle = "rgba(0,229,255,0.85)";
      ctx.lineWidth = 3;
      for (const [s, e] of conn) {
        ctx.beginPath();
        ctx.moveTo(lm[s].x * w, lm[s].y * h);
        ctx.lineTo(lm[e].x * w, lm[e].y * h);
        ctx.stroke();
      }
      ctx.fillStyle = "#ff3d7f";
      for (const p of lm) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
