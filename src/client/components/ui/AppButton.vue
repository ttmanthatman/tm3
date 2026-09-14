<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    variant?: "primary" | "ghost" | "danger" | "icon";
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    ariaLabel?: string;
  }>(),
  { variant: "primary", type: "button", disabled: false, ariaLabel: "" }
);

// Variants map onto the existing global button classes so migrated buttons
// keep their exact height, colors, focus, and disabled styling.
const variantClass = computed(
  () =>
    ({
      primary: "primary-btn",
      ghost: "mini-btn secondary",
      danger: "mini-btn danger-action",
      icon: "icon-btn"
    })[props.variant]
);
</script>

<template>
  <button :type="type" :class="variantClass" :disabled="disabled" :aria-label="ariaLabel || undefined"><slot /></button>
</template>
