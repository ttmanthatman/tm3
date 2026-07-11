<script setup lang="ts">
import { computed } from "vue";
import { parallaxAssetUrl, parallaxKit, type ParallaxKitId } from "../parallax";

const props = defineProps<{
  kit: ParallaxKitId;
  offset: number;
  preview?: boolean;
}>();

const activeKit = computed(() => parallaxKit(props.kit));

function layerStyle(file: string, depth: number, doubleHeight = false) {
  const shift = props.offset * depth;
  return {
    backgroundImage: `url("${parallaxAssetUrl(props.kit, file)}")`,
    backgroundPosition: `calc(50% + ${shift.toFixed(2)}px) top`,
    backgroundSize: doubleHeight ? "auto 200%" : "auto 100%"
  };
}
</script>

<template>
  <div v-if="activeKit" class="parallax-background" :class="{ preview }" aria-hidden="true">
    <div
      v-for="layer in activeKit.layers"
      :key="layer.id"
      class="parallax-layer"
      :class="`parallax-layer-${layer.id}`"
      :style="layerStyle(layer.file, layer.depth, layer.doubleHeight)"
    ></div>
  </div>
</template>
