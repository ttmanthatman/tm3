<script setup lang="ts">
defineProps<{ open: boolean }>();
</script>

<template>
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" :data-bible-icon="open ? 'open' : 'closed'" aria-hidden="true" focusable="false" stroke-linejoin="round" stroke-linecap="round">
    <g v-if="!open" transform="translate(1 1) rotate(-12 16 16) scale(.92)">
      <!-- The back cover encloses the entire red page block, including both corners. -->
      <path d="M8 6H23V27H8Q5.5 27 5.5 24.5V8.5Q5.5 6 8 6Z" fill="#242527" stroke="#363739" stroke-width=".8" />
      <path d="M8.7 22H22.4V25.7H8.7Q7 25.7 7 24Q7 22 8.7 22Z" fill="#c73542" stroke="#922937" stroke-width=".45" />
      <path d="M8.5 23.3h13.5M8.5 24.5h13.5" stroke="#e56565" stroke-width=".35" />
      <path d="M8 5H23V23H8Q6.5 23 6.5 24.5H5.5V7.5Q5.5 5 8 5Z" fill="#232426" stroke="#363739" stroke-width=".8" />
      <path d="M8.4 6.8v14.4" stroke="#515254" stroke-width=".55" />
      <text x="10" y="12.6" fill="#d8b45b" font-family="Songti SC, Noto Serif CJK SC, serif" font-size="5.2" font-weight="600">圣经</text>
    </g>
    <g v-else>
      <path d="M3.7 8.9Q9.5 7.2 16 11Q22.5 7.2 28.3 8.9L28.8 25Q22.1 23 16 26Q9.9 23 3.2 25Z" fill="#242527" stroke="#242527" stroke-width=".75" />
      <path d="M4.3 8.1Q10 7.5 16 11.2Q22 7.5 27.7 8.1L27.7 23.8Q21.4 21.8 16 24.6Q10.6 21.8 4.3 23.8Z" fill="#c73542" stroke="#922937" stroke-width=".55" />
      <path d="M4.3 6.2Q10 5.9 16 9.7Q22 5.9 27.7 6.2L27.7 22Q21.8 20.1 16 23.7Q10.2 20.1 4.3 22Z" fill="#fbf5df" stroke="#37383a" stroke-width="1.1" />
      <path d="M16 9.7v14" stroke="#b89d67" stroke-width=".8" />
      <path d="M7.2 10.8q3.1.1 5.9 1.7m-5.9 2q3.1.1 5.9 1.7m-5.9 2q3.1.1 5.9 1.7m5.8-7.4q2.8-1.6 5.9-1.7m-5.9 5.4q2.8-1.6 5.9-1.7m-5.9 5.4q2.8-1.6 5.9-1.7" stroke="#8e816b" stroke-width=".85" />
    </g>
  </svg>
</template>
