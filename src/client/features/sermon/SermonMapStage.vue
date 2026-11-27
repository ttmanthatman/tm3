<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import type { SermonMap } from "@shared/sermonMap";
const props = defineProps<{ map: SermonMap }>();
const arrow = useId();
const detail = ref<number | null>(null);
const box = ref<HTMLElement | null>(null);
const width = ref(600), height = ref(360);
const inspect = ref(false);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    width.value = entry.contentRect.width;
    height.value = entry.contentRect.height;
  });
  if (box.value) observer.observe(box.value);
});
onBeforeUnmount(() => observer?.disconnect());
watch(() => props.map, () => { inspect.value = false; detail.value = null; });
const points = computed(() => {
  const columns = [...new Set(props.map.nodes.map(n => n.column))].sort((a,b) => a-b);
  const rows = [...new Set(props.map.nodes.map(n => n.row))].sort((a,b) => a-b);
  return props.map.nodes.map(n => ({ ...n, x: columns.indexOf(n.column) * 315, y: rows.indexOf(n.row) * 96 }));
});
const current = computed(() => points.value.find(n => n.id === props.map.focus)!);
const viewing = computed(() => points.value.find(n => n.id === detail.value) ?? current.value);
const overall = computed(() => detail.value === null && (props.map.overview || inspect.value));
function toggleView() {
  if (detail.value !== null) { detail.value = null; inspect.value = true; }
  else inspect.value = !inspect.value;
}
const edges = computed(() => {
  const all = points.value;
  const tree = all.flatMap(n => n.parents.map(id => ({ from: id, to: n.id, label: "", cross: false })));
  return [...tree, ...props.map.links.map(link => ({ ...link, cross: true }))].map((edge, index) => {
    const a = all.find(n => n.id === edge.from)!, b = all.find(n => n.id === edge.to)!;
    const x1 = a.x + 250, y1 = a.y + 39, x2 = b.x, y2 = b.y + 39;
    const bend = (x1 + x2) / 2 + (edge.cross ? 70 : 0);
    return { ...edge, index, x: (x1+x2)/2, y: (y1+y2)/2, d: `M${x1},${y1} C${bend},${y1} ${bend},${y2} ${x2},${y2}` };
  });
});
const camera = computed(() => {
  const focus = viewing.value;
  const parent = points.value.find(n => focus.parents.length === 1 && n.id === focus.parents[0]);
  const showPair = detail.value === null && parent && width.value >= 600 && Math.abs(parent.y - focus.y) <= 192;
  const nodes = overall.value ? points.value : showPair ? [parent, focus] : [focus];
  const left = Math.min(...nodes.map(n => n.x)), top = Math.min(...nodes.map(n => n.y));
  const w = Math.max(...nodes.map(n => n.x)) + 250 - left;
  const h = Math.max(...nodes.map(n => n.y)) + 78 - top;
  const scale = Math.min((width.value - 32) / w, (height.value - 32) / h, overall.value ? 1.45 : 2.8);
  return { transform: `translate(${(width.value-w*scale)/2-left*scale}px,${(height.value-h*scale)/2-top*scale}px) scale(${scale})` };
});
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
    <div ref="box" class="map-window" :aria-label="overall ? '已讲全图' : current.title">
      <svg width="100%" height="100%" role="img" :aria-label="current.title">
        <defs><marker :id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#52697f" /></marker></defs>
        <g :style="camera">
          <g v-for="e in edges" :key="e.index"><path :d="e.d" fill="none" stroke="#8c918f" stroke-width="2" :marker-end="e.cross ? `url(#${arrow})` : undefined" :stroke-dasharray="e.cross ? '5 4' : undefined"/>
            <text v-if="e.label" :x="e.x" :y="e.y" fill="#303b45" font-size="13">{{ e.label }}</text>
          </g>
          <foreignObject v-for="n in points" :key="n.id" :x="n.x" :y="n.y" width="250" height="78">
            <button type="button" class="map-node" @click="detail = n.id" :class="{current:n.id===map.focus}" :style="{borderColor:colors[n.branch % colors.length]}">{{ n.title }}</button>
          </foreignObject>
        </g>
      </svg>
    </div>
    <slot />
    <details v-if="!overall && viewing.title.length > 65"><summary>阅读全文</summary>{{ viewing.title }}</details>
  </section>
</template>
<style scoped>
.map-stage{background:#fbfaf5;color:#263747;border-radius:12px;overflow:hidden;text-align:left}
.map-stage header{display:flex;align-items:center;justify-content:space-between;gap:.8em;padding:12px 16px;font:500 15px/1.45 system-ui;border-bottom:1px solid #deddd5}
.map-stage :deep(.map-scripture){font:16px/1.55 system-ui;padding:8px 14px;text-align:left}.map-stage header span{min-width:0;display:grid;gap:2px;max-height:5em;overflow:auto}.map-stage header small{color:#67756e}.map-stage header strong{font:650 18px/1.35 system-ui}
.map-stage header button{flex:none;border:1px solid #c3c9c4;border-radius:20px;padding:5px 12px;background:white;color:#344b46;cursor:pointer}
.map-window{height:clamp(180px,44vh,540px);overflow:hidden}
.map-window svg{display:block}.map-window svg>g{transition:transform .5s ease-in-out}
.map-node{width:100%;text-align:left;color:#253745;cursor:zoom-in;height:100%;box-sizing:border-box;border:2px solid;border-radius:10px;background:#fff;display:grid;align-content:center;padding:7px 12px;font:500 15px/1.35 system-ui;overflow:hidden;overflow-wrap:anywhere}
.map-node.current{background:#fff2d2;font-weight:700}
@media(prefers-reduced-motion:reduce){.map-window svg>g{transition:none}}
</style>
