<script setup lang="ts">
import type { ParallaxKitDTO, ParallaxLayerDTO } from "@shared/types";
import { parallaxAssetUrl } from "../parallax";

const props = defineProps<{
  kit?: ParallaxKitDTO | null;
  offset: number;
  preview?: boolean;
}>();

function layerStyle(layer: ParallaxLayerDTO) {
  const shift = props.offset * layer.speed;
  return {
    backgroundImage: `url("${parallaxAssetUrl(props.kit?.id || "", layer.file)}")`,
    backgroundPosition: `${shift.toFixed(2)}px ${layer.yOffset}px`,
    backgroundSize: `auto ${(layer.heightScale * 100).toFixed(2)}%`
  };
}
</script>

<template>
  <div v-if="kit" class="parallax-background" :class="{ preview }" aria-hidden="true">
    <div
      v-for="layer in kit.layers"
      :key="layer.id"
      class="parallax-layer"
      :class="`parallax-layer-${layer.id}`"
      :style="layerStyle(layer)"
    ></div>
  </div>
</template>
