import { z } from "zod";

export const mapCameraSchema = z.object({
  origin: z.string().max(64).optional(),
  x: z.number().finite().min(-250000).max(250000),
  y: z.number().finite().min(-250000).max(250000),
  width: z.number().finite().min(1).max(500000),
  height: z.number().finite().min(1).max(500000)
});
export type MapCamera = z.infer<typeof mapCameraSchema>;

export const sermonMapSchema = z.object({
  title: z.string().trim().min(1).max(300),
  nodes: z.array(z.object({
    id: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(600),
    column: z.number().int().min(0).max(300),
    row: z.number().min(0).max(600),
    branch: z.number().int().min(0).max(300),
    group: z.number().int().nonnegative().optional(),
    parents: z.array(z.number().int().nonnegative()).max(300)
  })).min(1).max(300),
  links: z.array(z.object({
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    label: z.string().max(300)
  })).max(300),
  focus: z.number().int().nonnegative(),
  camera: mapCameraSchema.optional(),
  step: z.string().max(64).optional(),
  family: z.boolean().optional(),
  overview: z.boolean()
}).refine(map => {
  const ids = new Set(map.nodes.map(n => n.id));
  return ids.size === map.nodes.length && ids.has(map.focus) && map.nodes.every(n => n.parents.every(id => ids.has(id)))
    && map.links.every(link => ids.has(link.from) && ids.has(link.to));
});
export type SermonMap = z.infer<typeof sermonMapSchema>;
