<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { frameNodes, mapCamera, mapPosition } from "./mapCamera";
import { useMapViewport } from "./useMapViewport";
import type { MapCamera, SermonMap } from "@shared/sermonMap";
const props = defineProps<{ map: SermonMap }>();
const emit = defineEmits<{ camera: [camera: MapCamera] }>();
const arrow = useId();
const detail = ref<number | null>(null);
const box = ref<HTMLElement | null>(null);
const inspect = ref(false);
const viewport = useMapViewport(() => props.map, box, camera => emit("camera", camera), () => {
  inspect.value = false;
  detail.value = null;
});
const points = computed(() => props.map.nodes.map(n => ({ ...n, ...mapPosition(n) })));
const visible = computed(() => props.map.family && !inspect.value
  ? points.value.filter(n => n.id === props.map.focus || current.value.parents.includes(n.id)) : points.value);
const current = computed(() => points.value.find(n => n.id === props.map.focus)!);
const viewing = computed(() => points.value.find(n => n.id === detail.value) ?? current.value);
const overall = computed(() => detail.value === null && (props.map.overview || inspect.value));
function toggleView() {
  if (detail.value !== null) { detail.value = null; inspect.value = true; }
  else inspect.value = !inspect.value;
  viewport.set(inspect.value ? frameNodes(props.map.nodes) : mapCamera(props.map));
}
const edges = computed(() => {
  const all = visible.value;
  const tree = all.flatMap(n => n.parents.map(id => ({ from: id, to: n.id, label: "", cross: false })));
  return [...tree, ...props.map.links.map(link => ({ ...link, cross: true }))].filter(e => all.some(n => n.id === e.from) && all.some(n => n.id === e.to)).map((edge, index) => {
    const a = all.find(n => n.id === edge.from)!, b = all.find(n => n.id === edge.to)!;
    const x1 = a.x + 250, y1 = a.y + 39, x2 = b.x, y2 = b.y + 39;
    const bend = (x1 + x2) / 2 + (edge.cross ? 70 : 0);
    return { ...edge, index, x: (x1+x2)/2, y: (y1+y2)/2, d: `M${x1},${y1} C${bend},${y1} ${bend},${y2} ${x2},${y2}` };
  });
});
function inspectNode(id: number) {
  detail.value = id;
  viewport.set(frameNodes([points.value.find(n => n.id === id)!]));
}
const colors = ["#334257","#ad741d","#ab5042","#364d85","#996d18"];
</script>
<template>
  <section class="map-stage">
    <header>
      <span>
        <small v-if="!overall && viewing.parents.length === 1">上一级　{{ points.find(n => n.id === viewing.parents[0])?.title }}</small>
        <small v-else-if="viewing.parents.length > 1">归纳自 {{ viewing.parents.length }} 个要点</small>
        <small v-else>{{ overall ? "已讲全图" : map.title }}</small>
        <strong>{{ viewing.title }}</strong>
      </span>
      <button v-if="!map.overview || detail !== null" type="button" @click="toggleView">{{ overall ? "回到当前要点" : "看已讲全图" }}</button>
    </header>
    <div ref="box" class="map-window" :class="{ moving: viewport.moving.value }"
      @pointerdown="viewport.down" @pointermove="viewport.move" @pointerup="viewport.up"
      @pointercancel="viewport.up" @lostpointercapture="viewport.up" @click.capture="viewport.guardClick" @wheel.stop.prevent="viewport.wheel" :aria-label="overall ? '已讲全图' : current.title">
      <svg width="100%" height="100%" role="img" :aria-label="current.title">
        <defs><marker :id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#52697f" /></marker></defs>
        <g :style="viewport.style.value">
          <g v-for="e in edges" :key="e.index"><path :d="e.d" fill="none" stroke="#8c918f" stroke-width="2" :marker-end="e.cross ? `url(#${arrow})` : undefined" :stroke-dasharray="e.cross ? '5 4' : undefined"/>
            <text v-if="e.label" :x="e.x" :y="e.y" fill="#303b45" font-size="13">{{ e.label }}</text>
          </g>
          <foreignObject v-for="n in visible" :key="n.id" :x="n.x" :y="n.y" width="250" height="78">
            <button type="button" class="map-node" @click="inspectNode(n.id)" :class="{current:n.id===map.focus}" :style="{borderColor:colors[n.branch % colors.length]}">{{ n.title }}</button>
          </foreignObject>
        </g>
      </svg>
    </div>
    <slot />
    <details v-if="!overall && viewing.title.length > 65"><summary>阅读全文</summary>{{ viewing.title }}</details>
  </section>
</template>
<style scoped>
.map-stage{display:flex;flex-direction:column;height:100%;min-height:0;background:#fbfaf5;color:#263747;overflow:hidden;text-align:left}
.map-stage header{display:flex;align-items:center;justify-content:space-between;gap:.8em;padding:12px 16px;font:500 15px/1.45 system-ui;border-bottom:1px solid #deddd5}
.map-stage :deep(.map-scripture){font:16px/1.55 system-ui;padding:8px 14px;text-align:left}.map-stage header span{min-width:0;display:grid;gap:2px;max-height:5em;overflow:auto}.map-stage header small{color:#67756e}.map-stage header strong{font:650 18px/1.35 system-ui}
.map-stage header button{flex:none;border:1px solid #c3c9c4;border-radius:20px;padding:5px 12px;background:white;color:#344b46;cursor:pointer}
.map-window{flex:1;min-height:0;overflow:hidden;touch-action:none;user-select:none;cursor:grab}.map-window.moving{cursor:grabbing}.map-stage details{max-height:40%;overflow:auto}
.map-window svg{display:block}.map-window svg>g{transition:transform .18s ease-out}
.map-window.moving svg>g{transition:none}
.map-node{width:100%;text-align:left;color:#253745;cursor:zoom-in;height:100%;box-sizing:border-box;border:2px solid;border-radius:10px;background:#fff;display:grid;align-content:center;padding:7px 12px;font:500 15px/1.35 system-ui;overflow:hidden;overflow-wrap:anywhere}
.map-node.current{background:#fff2d2;font-weight:700}
@media(prefers-reduced-motion:reduce){.map-window svg>g{transition:none}}
</style>
