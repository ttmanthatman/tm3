import type { HandwritingPoint, HandwritingStroke } from "@shared/handwriting";

// Brush dynamics are driven by stable path distance. Stationary time may
// inform turn/lift inference and the initial press, but it never relaxes an
// already-deformed tip while the stroke is being written.
export type BrushSample = {
  x: number;
  y: number;
  width: number;
  angle: number;
  contact: number;
  spread: number;
  trailX: number;
  trailY: number;
  phase: BrushPhase;
  rawX: number;
  rawY: number;
  inputX: number;
  inputY: number;
  handleX: number;
  handleY: number;
  speed: number;
};

export type BrushPhase = "touching" | "pressing" | "writing" | "lifting" | "turning";

type MotionPoint = {
  x: number;
  y: number;
  timestampMs: number;
  arcLength: number;
};

type BrushState = {
  handleX: number;
  handleY: number;
  tipX: number;
  tipY: number;
  rawX: number;
  rawY: number;
  inputX: number;
  inputY: number;
  inputVelocityX: number;
  inputVelocityY: number;
  inputTimeMs: number;
  motionPath: MotionPoint[];
  width: number;
  angle: number;
  tangentAngle: number;
  movementHeading: number;
  turnReferenceHeading: number;
  speed: number;
  contact: number;
  spread: number;
  phase: BrushPhase;
  startPhase: boolean;
  startElapsedMs: number;
  startTravel: number;
  turnTravel: number;
  turnCandidateTravel: number;
  pauseEvidence: number;
  liftContact: number;
  stationaryMs: number;
  hasHeading: boolean;
};

export type BrushGeometry = {
  samples: BrushSample[];
  ends: number[];
  state: BrushState | null;
};

const cache = new WeakMap<HandwritingStroke, BrushGeometry>();

const SIMULATION_STEP = 32;
const MAX_SIMULATION_STEPS = 32;
const HEADING_WINDOW = 96;
const SPEED_WINDOW_MS = 64;
const TWO_PI = Math.PI * 2;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(minimum: number, maximum: number, value: number) {
  const amount = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function normalizeAngle(angle: number) {
  return ((((angle + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
}

function shortestAngleDelta(from: number, to: number) {
  return normalizeAngle(to - from);
}

function smoothingFactor(cutoffHz: number, elapsedMs: number) {
  const radians = (TWO_PI * cutoffHz * Math.max(1, elapsedMs)) / 1000;
  return radians / (radians + 1);
}

function brushParameters(brush: NonNullable<HandwritingStroke["brush"]>) {
  const lag = clamp(brush.lag, 0, 100);
  return {
    maxWidth: 120 + clamp(brush.size, 0, 100) * 12,
    speedSensitivity: clamp(brush.sensitivity, 0, 100),
    maxDeflection: lag === 0 ? 0 : 34 + lag * 1.45,
    stickRadius: lag === 0 ? 0 : 5 + lag * 0.32,
    // Positional lag and angular inertia are separate controls. Even with lag
    // zero, the brush keeps a short spatial memory for its cross-section.
    angleResponseLength: 84 + lag * 0.62,
    turnReorientDistance: 72 + lag * 0.72,
    pressDistance: 82 + lag * 0.68
  };
}

function initialSample(point: HandwritingPoint, state: BrushState): BrushSample {
  return {
    x: point[0],
    y: point[1],
    width: state.width,
    angle: state.angle,
    contact: state.contact,
    spread: state.spread,
    trailX: 0,
    trailY: 0,
    phase: state.phase,
    rawX: point[0],
    rawY: point[1],
    inputX: point[0],
    inputY: point[1],
    handleX: point[0],
    handleY: point[1],
    speed: 0
  };
}

function initialGeometry(point: HandwritingPoint, maxWidth: number): BrushGeometry {
  const width = maxWidth * 0.06;
  const state: BrushState = {
    handleX: point[0],
    handleY: point[1],
    tipX: point[0],
    tipY: point[1],
    rawX: point[0],
    rawY: point[1],
    inputX: point[0],
    inputY: point[1],
    inputVelocityX: 0,
    inputVelocityY: 0,
    inputTimeMs: point[2],
    motionPath: [{ x: point[0], y: point[1], timestampMs: point[2], arcLength: 0 }],
    width,
    angle: Math.PI / 4,
    tangentAngle: Math.PI / 4,
    movementHeading: Math.PI / 4,
    turnReferenceHeading: Math.PI / 4,
    speed: 0,
    contact: 0.08,
    spread: 0.12,
    phase: "touching",
    startPhase: true,
    startElapsedMs: 0,
    startTravel: 0,
    turnTravel: 0,
    turnCandidateTravel: 0,
    pauseEvidence: 0,
    liftContact: 1,
    stationaryMs: 0,
    hasHeading: false
  };
  return {
    samples: [initialSample(point, state)],
    ends: [],
    state
  };
}

function updateInputPoint(state: BrushState, x: number, y: number, timestampMs: number) {
  const elapsed = Math.max(1, timestampMs - state.inputTimeMs);
  const derivativeX = (x - state.rawX) / elapsed;
  const derivativeY = (y - state.rawY) / elapsed;
  const derivativeAlpha = smoothingFactor(1, elapsed);
  state.inputVelocityX += (derivativeX - state.inputVelocityX) * derivativeAlpha;
  state.inputVelocityY += (derivativeY - state.inputVelocityY) * derivativeAlpha;
  const speed = Math.hypot(state.inputVelocityX, state.inputVelocityY);
  const cutoff = 0.75 + 0.12 * speed;
  const alpha = smoothingFactor(cutoff, elapsed);
  const previousX = state.inputX;
  const previousY = state.inputY;
  state.inputX += (x - state.inputX) * alpha;
  state.inputY += (y - state.inputY) * alpha;
  state.inputTimeMs = timestampMs;
  return {
    x: state.inputX,
    y: state.inputY,
    distance: Math.hypot(state.inputX - previousX, state.inputY - previousY)
  };
}

function appendMotionPoint(state: BrushState, x: number, y: number, timestampMs: number) {
  const previous = state.motionPath.at(-1);
  const arcLength =
    (previous?.arcLength || 0) + Math.hypot(x - (previous?.x ?? x), y - (previous?.y ?? y));
  state.motionPath.push({ x, y, timestampMs, arcLength });
  const latest = state.motionPath.at(-1)!;
  while (
    state.motionPath.length > 3 &&
    latest.arcLength - state.motionPath[0].arcLength > 360 &&
    latest.timestampMs - state.motionPath[0].timestampMs > 180
  ) {
    state.motionPath.shift();
  }
}

function spatialHeading(state: BrushState, fallback: number) {
  const latest = state.motionPath.at(-1);
  if (!latest) return fallback;
  const targetArc = latest.arcLength - HEADING_WINDOW;
  let index = state.motionPath.length - 1;
  while (index > 0 && state.motionPath[index - 1].arcLength > targetArc) index -= 1;
  const from = state.motionPath[index];
  const dx = latest.x - from.x;
  const dy = latest.y - from.y;
  return Math.hypot(dx, dy) > 1 ? Math.atan2(dy, dx) : fallback;
}

function windowedSpeed(state: BrushState, fallback: number) {
  const latest = state.motionPath.at(-1);
  if (!latest) return fallback;
  const cutoff = latest.timestampMs - SPEED_WINDOW_MS;
  let index = state.motionPath.length - 1;
  while (index > 0 && state.motionPath[index - 1].timestampMs >= cutoff) index -= 1;
  const from = state.motionPath[index];
  const elapsed = Math.max(1, latest.timestampMs - from.timestampMs);
  return Math.max(0, (latest.arcLength - from.arcLength) / elapsed);
}

function turnInference(
  state: BrushState,
  heading: number,
  distance: number,
  speed: number,
  pauseDuration: number
) {
  if (!state.hasHeading || state.phase !== "writing" || distance < 12) return;
  const pauseEvidence = state.pauseEvidence;
  state.pauseEvidence *= Math.exp(-distance / 160);
  if (state.turnCandidateTravel === 0) state.turnReferenceHeading = state.movementHeading;
  const turnAngle = Math.abs(shortestAngleDelta(state.turnReferenceHeading, heading));
  if (turnAngle < (Math.PI * 22) / 180) {
    state.turnCandidateTravel = 0;
    return;
  }
  if (turnAngle >= (Math.PI * 35) / 180) state.turnCandidateTravel += distance;
  else state.turnCandidateTravel = Math.max(0, state.turnCandidateTravel - distance * 0.35);
  const angleScore = smoothstep((Math.PI * 35) / 180, (Math.PI * 100) / 180, turnAngle);
  const pauseScore = Math.max(smoothstep(80, 300, pauseDuration), pauseEvidence);
  const speedDrop = clamp((state.speed - speed) / Math.max(1, state.speed + speed), 0, 1);
  const slowdownScore = smoothstep(0.22, 0.72, speedDrop);
  const evidence = Math.max(pauseScore, slowdownScore);
  const confidence = angleScore * (0.38 + 0.62 * evidence);
  if (state.turnCandidateTravel < 72 || evidence < 0.28 || confidence < 0.42) return;
  state.phase = "lifting";
  state.turnTravel = 0;
  state.turnCandidateTravel = 0;
  state.liftContact = clamp(1 - confidence * 0.76, 0.24, 0.72);
}

function advancePhase(
  state: BrushState,
  distance: number,
  parameters: ReturnType<typeof brushParameters>
) {
  if (state.phase === "writing" || state.phase === "touching") return;
  state.turnTravel += distance;
  if (state.phase === "lifting" && state.turnTravel >= 24) {
    state.phase = "turning";
    return;
  }
  if (state.phase === "turning" && state.turnTravel >= parameters.turnReorientDistance) {
    state.phase = "pressing";
    return;
  }
  if (
    state.phase === "pressing" &&
    state.turnTravel >= parameters.turnReorientDistance + parameters.pressDistance
  ) {
    state.phase = "writing";
    state.turnTravel = 0;
    state.liftContact = 1;
  }
}

function targetContact(state: BrushState, parameters: ReturnType<typeof brushParameters>) {
  if (state.startPhase) {
    if (state.phase === "touching") return 0.08;
    return 0.08 + 0.64 * smoothstep(50, 350, state.startElapsedMs);
  }
  if (state.phase === "writing") return 1;
  if (state.phase === "pressing") {
    const pressTravel = clamp(
      state.turnTravel - parameters.turnReorientDistance,
      0,
      parameters.pressDistance
    );
    return (
      state.liftContact +
      (1 - state.liftContact) * smoothstep(0, parameters.pressDistance, pressTravel)
    );
  }
  return state.liftContact;
}

function pushBrushSample(geometry: BrushGeometry, state: BrushState) {
  geometry.samples.push({
    x: state.tipX,
    y: state.tipY,
    width: state.width,
    angle: state.angle,
    contact: state.contact,
    spread: state.spread,
    trailX: state.handleX - state.tipX,
    trailY: state.handleY - state.tipY,
    phase: state.phase,
    rawX: state.rawX,
    rawY: state.rawY,
    inputX: state.inputX,
    inputY: state.inputY,
    handleX: state.handleX,
    handleY: state.handleY,
    speed: state.speed
  });
}

function advanceStartPhase(state: BrushState, distance: number, elapsed: number) {
  state.startElapsedMs += elapsed;
  state.startTravel += distance;
  if (state.phase === "touching" && state.startElapsedMs >= 50) state.phase = "pressing";
  const transitionDistance = state.phase === "pressing" ? 96 : 56;
  if (state.startTravel >= transitionDistance) {
    state.phase = "writing";
    state.startPhase = false;
    state.startTravel = 0;
    state.contact = Math.max(state.contact, 0.72);
  }
}

function advanceBrushState(
  geometry: BrushGeometry,
  state: BrushState,
  x: number,
  y: number,
  heading: number,
  distance: number,
  elapsed: number,
  pauseDuration: number,
  speed: number,
  parameters: ReturnType<typeof brushParameters>
) {
  const steps = Math.min(MAX_SIMULATION_STEPS, Math.max(1, Math.ceil(distance / SIMULATION_STEP)));
  const stepDistance = distance / steps;
  const stepElapsed = elapsed / steps;
  const startHandleX = state.handleX;
  const startHandleY = state.handleY;
  turnInference(state, heading, distance, speed, pauseDuration);
  for (let step = 1; step <= steps; step += 1) {
    const amount = step / steps;
    state.handleX = startHandleX + (x - startHandleX) * amount;
    state.handleY = startHandleY + (y - startHandleY) * amount;
    if (state.startPhase) advanceStartPhase(state, stepDistance, stepElapsed);

    state.speed += (speed - state.speed) * (1 - Math.exp(-stepDistance / 72));

    const deflectionX = state.handleX - state.tipX;
    const deflectionY = state.handleY - state.tipY;
    const deflection = Math.hypot(deflectionX, deflectionY);
    const liftScale = state.phase === "writing" ? 1 : 0.34 + 0.66 * state.contact;
    const maxDeflection = Math.max(0, parameters.maxDeflection * liftScale);
    const stickRadius = Math.max(0, parameters.stickRadius * liftScale);
    if (
      parameters.maxDeflection === 0 ||
      (deflection <= stickRadius && state.phase === "writing")
    ) {
      if (parameters.maxDeflection === 0) {
        state.tipX = state.handleX;
        state.tipY = state.handleY;
      }
    } else if (deflection > maxDeflection) {
      const scale = maxDeflection / deflection;
      state.tipX = state.handleX - deflectionX * scale;
      state.tipY = state.handleY - deflectionY * scale;
    }

    const trailX = state.handleX - state.tipX;
    const trailY = state.handleY - state.tipY;
    // Positional lag may move the handle away from the tip, but the brush
    // cross-section keeps its own angular inertia and follows a separately
    // smoothed spatial tangent rather than the instantaneous trail vector.
    const tangentFollow = 1 - Math.exp(-stepDistance / 140);
    state.tangentAngle = normalizeAngle(
      state.tangentAngle + shortestAngleDelta(state.tangentAngle, heading) * tangentFollow
    );
    const desiredAngle = state.tangentAngle;
    const angleResponse =
      state.phase === "lifting" || state.phase === "turning"
        ? parameters.angleResponseLength * 1.16
        : parameters.angleResponseLength;
    const angleFollow = 1 - Math.exp(-stepDistance / Math.max(1, angleResponse));
    state.angle = normalizeAngle(
      state.angle + shortestAngleDelta(state.angle, desiredAngle) * angleFollow
    );

    const nextContact = targetContact(state, parameters);
    const contactFollow =
      1 -
      Math.exp(
        -stepDistance / (state.phase === "lifting" ? 12 : state.phase === "turning" ? 20 : 24)
      );
    state.contact += (nextContact - state.contact) * contactFollow;
    const startSpread = 0.12 + 0.78 * smoothstep(50, 350, state.startElapsedMs);
    const spreadTarget = state.startPhase
      ? startSpread
      : clamp(0.34 + 0.66 * state.contact - clamp(state.speed / 120, 0, 0.16), 0, 1);
    state.spread += (spreadTarget - state.spread) * (1 - Math.exp(-stepDistance / 16));

    const speedWidth =
      parameters.maxWidth * (0.12 + 0.88 / (1 + (state.speed * parameters.speedSensitivity) / 250));
    const widthTarget = speedWidth * (0.62 + 0.38 * state.contact) * (0.7 + 0.3 * state.spread);
    state.width += (widthTarget - state.width) * (1 - Math.exp(-stepDistance / 30));

    advancePhase(state, stepDistance, parameters);
    state.movementHeading = heading;
    state.hasHeading = true;
    pushBrushSample(geometry, state);
  }
}

// Geometry depends only on persisted coordinates, relative time and this
// stroke's settings. Extending a stroke computes only its new samples.
export function handwritingBrushGeometry(stroke: HandwritingStroke): BrushGeometry {
  const brush = stroke.brush;
  if (!brush || stroke.points.length === 0) return { samples: [], ends: [], state: null };
  const parameters = brushParameters(brush);
  let geometry = cache.get(stroke);
  if (!geometry || geometry.state === null || geometry.ends.length > stroke.points.length) {
    geometry = initialGeometry(stroke.points[0], parameters.maxWidth);
    cache.set(stroke, geometry);
  }
  const state = geometry.state;
  if (!state) throw new Error("Brush geometry state was not initialized");

  for (let index = geometry.ends.length; index < stroke.points.length; index += 1) {
    const point = stroke.points[index];
    if (index === 0) {
      geometry.ends.push(geometry.samples.length);
      continue;
    }

    const previous: HandwritingPoint = stroke.points[index - 1];
    const rawDistance = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    const elapsed = Math.max(1, point[2] - previous[2]);
    state.rawX = point[0];
    state.rawY = point[1];
    if (rawDistance === 0) {
      state.stationaryMs += elapsed;
      if (state.startPhase) {
        advanceStartPhase(state, 0, elapsed);
        const nextContact = targetContact(state, parameters);
        state.contact += (nextContact - state.contact) * (1 - Math.exp(-elapsed / 24));
        const nextSpread = 0.12 + 0.78 * smoothstep(50, 350, state.startElapsedMs);
        state.spread += (nextSpread - state.spread) * (1 - Math.exp(-elapsed / 16));
        const speedWidth =
          parameters.maxWidth *
          (0.12 + 0.88 / (1 + (state.speed * parameters.speedSensitivity) / 250));
        const widthTarget = speedWidth * (0.62 + 0.38 * state.contact) * (0.7 + 0.3 * state.spread);
        state.width += (widthTarget - state.width) * (1 - Math.exp(-elapsed / 30));
        pushBrushSample(geometry, state);
      }
      geometry.ends.push(geometry.samples.length);
      continue;
    }

    updateInputPoint(state, point[0], point[1], point[2]);
    // Keep the spatial tangent window on the raw arc so a persistent direction
    // converges even when the adaptive filter is still catching up.
    appendMotionPoint(state, point[0], point[1], point[2]);
    const distance = rawDistance;
    if (distance < 0.01) {
      state.stationaryMs += elapsed;
      geometry.ends.push(geometry.samples.length);
      continue;
    }
    const previousMotion = state.motionPath.at(-2);
    const heading = spatialHeading(
      state,
      state.hasHeading || !previousMotion
        ? state.movementHeading
        : Math.atan2(point[1] - previousMotion.y, point[0] - previousMotion.x)
    );
    const speed = windowedSpeed(state, distance / elapsed);
    const pauseDuration = state.stationaryMs + elapsed;
    state.pauseEvidence = Math.max(state.pauseEvidence, smoothstep(80, 300, pauseDuration));
    advanceBrushState(
      geometry,
      state,
      point[0],
      point[1],
      heading,
      distance,
      elapsed,
      pauseDuration,
      speed,
      parameters
    );
    state.stationaryMs = 0;
    geometry.ends.push(geometry.samples.length);
  }
  return geometry;
}

export function brushSampleEdges(
  samples: readonly BrushSample[],
  from = 0,
  until = samples.length
) {
  const left: Array<{ x: number; y: number }> = [];
  const right: Array<{ x: number; y: number }> = [];
  for (let index = Math.max(0, from); index < Math.min(samples.length, until); index += 1) {
    const sample = samples[index];
    const normalX = -Math.sin(sample.angle);
    const normalY = Math.cos(sample.angle);
    const halfWidth = Math.max(0.5, sample.width / 2);
    left.push({ x: sample.x + normalX * halfWidth, y: sample.y + normalY * halfWidth });
    right.push({ x: sample.x - normalX * halfWidth, y: sample.y - normalY * halfWidth });
  }
  return { left, right };
}
