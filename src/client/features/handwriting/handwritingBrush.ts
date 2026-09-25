import type { HandwritingPoint, HandwritingStroke } from "@shared/handwriting";

// Brush dynamics are path-length driven, not wall-clock driven.
// Stationary time may inform turn/lift inference but must never relax
// tip deformation by itself.
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
};

export type BrushPhase = "writing" | "lifting" | "turning" | "pressing";

type BrushState = {
  handleX: number;
  handleY: number;
  tipX: number;
  tipY: number;
  width: number;
  angle: number;
  movementHeading: number;
  speed: number;
  contact: number;
  spread: number;
  phase: BrushPhase;
  turnTravel: number;
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
const TWO_PI = Math.PI * 2;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(minimum: number, maximum: number, value: number) {
  const amount = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function normalizeAngle(angle: number) {
  return ((angle + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
}

function shortestAngleDelta(from: number, to: number) {
  return normalizeAngle(to - from);
}

function distanceAndHeading(fromX: number, fromY: number, toX: number, toY: number) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  return {
    distance: Math.hypot(dx, dy),
    heading: Math.atan2(dy, dx)
  };
}

function brushParameters(brush: NonNullable<HandwritingStroke["brush"]>) {
  const lag = clamp(brush.lag, 0, 100);
  return {
    maxWidth: 120 + clamp(brush.size, 0, 100) * 12,
    speedSensitivity: clamp(brush.sensitivity, 0, 100),
    maxDeflection: lag === 0 ? 0 : 34 + lag * 1.45,
    stickRadius: lag === 0 ? 0 : 5 + lag * 0.32,
    turnResponseLength: lag === 0 ? 1 : 13 + lag * 0.72,
    turnReorientDistance: 52 + lag * 0.72,
    pressDistance: 82 + lag * 0.68
  };
}

function initialSample(x: number, y: number, width: number): BrushSample {
  return {
    x,
    y,
    width,
    angle: Math.PI / 4,
    contact: 1,
    spread: 1,
    trailX: 0,
    trailY: 0,
    phase: "writing"
  };
}

function initialGeometry(point: HandwritingPoint, maxWidth: number): BrushGeometry {
  const width = maxWidth * 0.55;
  return {
    samples: [initialSample(point[0], point[1], width)],
    ends: [],
    state: {
      handleX: point[0],
      handleY: point[1],
      tipX: point[0],
      tipY: point[1],
      width,
      angle: Math.PI / 4,
      movementHeading: Math.PI / 4,
      speed: 0,
      contact: 1,
      spread: 1,
      phase: "writing",
      turnTravel: 0,
      liftContact: 1,
      stationaryMs: 0,
      hasHeading: false
    }
  };
}

function turnInference(
  state: BrushState,
  heading: number,
  distance: number,
  speed: number,
  pauseDuration: number
) {
  if (!state.hasHeading || state.phase !== "writing" || distance < 2) return;
  const turnAngle = Math.abs(shortestAngleDelta(state.movementHeading, heading));
  const angleScore = smoothstep(Math.PI * 35 / 180, Math.PI * 100 / 180, turnAngle);
  if (angleScore <= 0) return;
  const pauseScore = smoothstep(40, 250, pauseDuration);
  const speedDrop = clamp((state.speed - speed) / Math.max(1, state.speed + speed), 0, 1);
  const slowdownScore = smoothstep(0.16, 0.68, speedDrop);
  const evidence = Math.max(pauseScore, slowdownScore * 0.82);
  const confidence = angleScore * (0.45 + 0.55 * evidence);
  state.phase = "lifting";
  state.turnTravel = 0;
  state.liftContact = clamp(1 - confidence * 0.76, 0.24, 0.72);
}

function advancePhase(state: BrushState, distance: number, parameters: ReturnType<typeof brushParameters>) {
  if (state.phase === "writing") return;
  state.turnTravel += distance;
  if (state.phase === "lifting" && state.turnTravel >= 10) {
    state.phase = "turning";
    return;
  }
  if (state.phase === "turning" && state.turnTravel >= parameters.turnReorientDistance) {
    state.phase = "pressing";
    return;
  }
  if (
    state.phase === "pressing"
    && state.turnTravel >= parameters.turnReorientDistance + parameters.pressDistance
  ) {
    state.phase = "writing";
    state.turnTravel = 0;
    state.liftContact = 1;
  }
}

function targetContact(state: BrushState, parameters: ReturnType<typeof brushParameters>) {
  if (state.phase === "writing") return 1;
  if (state.phase === "pressing") {
    const pressTravel = clamp(state.turnTravel - parameters.turnReorientDistance, 0, parameters.pressDistance);
    return state.liftContact + (1 - state.liftContact) * smoothstep(0, parameters.pressDistance, pressTravel);
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
    phase: state.phase
  });
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
  parameters: ReturnType<typeof brushParameters>
) {
  const speed = distance / Math.max(1, elapsed);
  turnInference(state, heading, distance, speed, pauseDuration);

  const steps = Math.min(MAX_SIMULATION_STEPS, Math.max(1, Math.ceil(distance / SIMULATION_STEP)));
  const stepDistance = distance / steps;
  const startHandleX = state.handleX;
  const startHandleY = state.handleY;
  for (let step = 1; step <= steps; step += 1) {
    const amount = step / steps;
    state.handleX = startHandleX + (x - startHandleX) * amount;
    state.handleY = startHandleY + (y - startHandleY) * amount;

    state.speed += (speed - state.speed) * (1 - Math.exp(-stepDistance / 48));

    const deflectionX = state.handleX - state.tipX;
    const deflectionY = state.handleY - state.tipY;
    const deflection = Math.hypot(deflectionX, deflectionY);
    const liftScale = state.phase === "writing" ? 1 : 0.34 + 0.66 * state.contact;
    const maxDeflection = Math.max(0, parameters.maxDeflection * liftScale);
    const stickRadius = Math.max(0, parameters.stickRadius * liftScale);
    if (parameters.maxDeflection === 0 || (deflection <= stickRadius && state.phase === "writing")) {
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
    const trail = Math.hypot(trailX, trailY);
    const desiredAngle = trail >= 1 ? Math.atan2(trailY, trailX) : heading;
    const responseScale = state.phase === "lifting" || state.phase === "turning"
      ? 0.34
      : state.phase === "pressing" ? 0.62 : 1;
    const angleFollow = 1 - Math.exp(-stepDistance / Math.max(1, parameters.turnResponseLength * responseScale));
    state.angle = normalizeAngle(state.angle + shortestAngleDelta(state.angle, desiredAngle) * angleFollow);

    const nextContact = targetContact(state, parameters);
    const contactFollow = 1 - Math.exp(-stepDistance / (state.phase === "lifting" ? 12 : state.phase === "turning" ? 20 : 24));
    state.contact += (nextContact - state.contact) * contactFollow;
    const spreadTarget = clamp(0.34 + 0.66 * state.contact - clamp(state.speed / 120, 0, 0.16), 0, 1);
    state.spread += (spreadTarget - state.spread) * (1 - Math.exp(-stepDistance / 16));

    const speedWidth = parameters.maxWidth * (0.12 + 0.88 / (1 + state.speed * parameters.speedSensitivity / 250));
    const widthTarget = speedWidth * (0.62 + 0.38 * state.contact) * (0.7 + 0.3 * state.spread);
    state.width += (widthTarget - state.width) * (1 - Math.exp(-stepDistance / 30));

    advancePhase(state, stepDistance, parameters);
    state.movementHeading = heading;
    state.hasHeading = true;
    pushBrushSample(geometry, state);
  }
}

// Geometry depends only on persisted coordinates, relative time and this stroke's settings.
// Extending a stroke only computes its new samples; replay reuses the same prefix.
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
    const { distance, heading } = distanceAndHeading(previous[0], previous[1], point[0], point[1]);
    const elapsed = Math.max(1, point[2] - previous[2]);
    if (distance === 0) {
      state.stationaryMs += elapsed;
      geometry.ends.push(geometry.samples.length);
      continue;
    }

    const pauseDuration = state.stationaryMs + elapsed;
    advanceBrushState(geometry, state, point[0], point[1], heading, distance, elapsed, pauseDuration, parameters);
    state.stationaryMs = 0;
    geometry.ends.push(geometry.samples.length);
  }
  return geometry;
}

export function brushSampleEdges(samples: readonly BrushSample[], from = 0, until = samples.length) {
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
