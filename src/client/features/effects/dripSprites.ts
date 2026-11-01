import { clamp } from "./effectShared";

type DripParticle = {
  x: number; y: number; radius: number; mass: number; stretch: number;
  anchorX: number; anchorY: number; vy: number;
};

export const DRIP_SPRITE_RADIUS = 8;
const STEPS = 8;

/** Bake the original paths, gradients, highlights and shadows once per active session. */
export function createDripSprites() {
  function texture(draw: (context: CanvasRenderingContext2D, particle: DripParticle) => void, step: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable for water effect texture");
    const stretch = step / (STEPS - 1);
    draw(context, { x: 32, y: draw === drawAttachedDrip ? 8 + DRIP_SPRITE_RADIUS * (0.74 + stretch * 1.45 * 1.05) : 32,
      radius: DRIP_SPRITE_RADIUS, mass: 2, stretch: stretch * 1.45, anchorX: 32, anchorY: 8, vy: stretch * 0.72 * 1300 });
    return canvas;
  }
  return {
    attached: Array.from({ length: STEPS }, (_, step) => texture(drawAttachedDrip, step)),
    falling: Array.from({ length: STEPS }, (_, step) => texture(drawFallingDrip, step))
  };
}
  function drawAttachedDrip(context: CanvasRenderingContext2D, particle: DripParticle) {
    const alpha = clamp(0.42 + particle.mass * 0.42, 0.45, 0.96);
    const neck = clamp(particle.stretch, 0, 1.45);
    const width = particle.radius * (0.82 - neck * 0.12);
    context.save();
    context.globalAlpha = alpha;
    context.beginPath();
    context.moveTo(particle.anchorX - width * 0.42, particle.anchorY - 1);
    context.bezierCurveTo(particle.anchorX - width * 0.72, particle.anchorY + particle.radius, particle.x - particle.radius * 0.96, particle.y - particle.radius * 0.7, particle.x - particle.radius * 0.8, particle.y);
    context.bezierCurveTo(particle.x - particle.radius * 0.62, particle.y + particle.radius * 1.1, particle.x + particle.radius * 0.62, particle.y + particle.radius * 1.1, particle.x + particle.radius * 0.8, particle.y);
    context.bezierCurveTo(particle.x + particle.radius * 0.96, particle.y - particle.radius * 0.7, particle.anchorX + width * 0.72, particle.anchorY + particle.radius, particle.anchorX + width * 0.42, particle.anchorY - 1);
    context.closePath();
    const gradient = context.createRadialGradient(
      particle.x - particle.radius * 0.38,
      particle.y - particle.radius * 0.52,
      particle.radius * 0.1,
      particle.x,
      particle.y + particle.radius * 0.22,
      particle.radius * (1.7 + neck * 0.52)
    );
    gradient.addColorStop(0, "rgba(255,255,255,0.96)");
    gradient.addColorStop(0.22, "rgba(205,244,255,0.82)");
    gradient.addColorStop(0.66, "rgba(56,189,248,0.58)");
    gradient.addColorStop(1, "rgba(3,105,161,0.5)");
    context.fillStyle = gradient;
    context.fill();
    drawDripHighlights(context, particle.x, particle.y, particle.radius, alpha);
    context.restore();
  }

  function drawFallingDrip(context: CanvasRenderingContext2D, particle: DripParticle) {
    const speedStretch = clamp(particle.vy / 1300, 0, 0.72);
    const radiusX = particle.radius * (1 - speedStretch * 0.2);
    const radiusY = particle.radius * (1.08 + speedStretch);
    context.save();
    context.translate(particle.x, particle.y);
    context.beginPath();
    context.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
    const gradient = context.createRadialGradient(-radiusX * 0.35, -radiusY * 0.42, radiusX * 0.12, 0, radiusY * 0.16, radiusY * 1.12);
    gradient.addColorStop(0, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.28, "rgba(186,230,253,0.78)");
    gradient.addColorStop(0.78, "rgba(14,165,233,0.68)");
    gradient.addColorStop(1, "rgba(3,105,161,0.46)");
    context.fillStyle = gradient;
    context.shadowColor = "rgba(3,105,161,0.22)";
    context.shadowBlur = 8;
    context.shadowOffsetY = 3;
    context.fill();
    context.shadowColor = "transparent";
    drawDripHighlights(context, 0, 0, particle.radius, 0.88);
    context.restore();
  }

  function drawDripHighlights(context: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha: number) {
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = "rgba(255,255,255,0.82)";
    context.beginPath();
    context.ellipse(x - radius * 0.34, y - radius * 0.44, radius * 0.22, radius * 0.34, -0.45, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(255,255,255,0.38)";
    context.lineWidth = Math.max(0.7, radius * 0.12);
    context.beginPath();
    context.arc(x + radius * 0.1, y + radius * 0.08, radius * 0.58, 0.55, 1.72);
    context.stroke();
    context.restore();
  }
