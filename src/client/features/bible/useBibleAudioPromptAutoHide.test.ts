import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { ref } from "vue";
import { BIBLE_AUDIO_PROMPT_REAPPEAR_MS, useBibleAudioPromptAutoHide } from "./useBibleAudioPromptAutoHide";

function harness() {
  const active = ref(true);
  const autoHide = useBibleAudioPromptAutoHide({ sessionActive: () => active.value });
  return { active, autoHide };
}

test("a chat tap collapses the prompter and it returns after five quiet seconds", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { autoHide } = harness();
    assert.equal(autoHide.hidden.value, false);
    autoHide.collapse();
    assert.equal(autoHide.hidden.value, true);
    mock.timers.tick(BIBLE_AUDIO_PROMPT_REAPPEAR_MS - 1);
    assert.equal(autoHide.hidden.value, true);
    mock.timers.tick(1);
    assert.equal(autoHide.hidden.value, false);
  } finally {
    mock.timers.reset();
  }
});

test("every further tap pushes the five-second window back instead of stacking timers", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { autoHide } = harness();
    autoHide.collapse();
    mock.timers.tick(4000);
    autoHide.collapse();
    mock.timers.tick(4000);
    assert.equal(autoHide.hidden.value, true, "the first timer must not bring it back early");
    mock.timers.tick(1000);
    assert.equal(autoHide.hidden.value, false);
  } finally {
    mock.timers.reset();
  }
});

test("ending the session resets the prompter so the next session starts visible", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { active, autoHide } = harness();
    autoHide.collapse();
    active.value = false;
    assert.equal(autoHide.hidden.value, false);
    active.value = true;
    mock.timers.tick(BIBLE_AUDIO_PROMPT_REAPPEAR_MS);
    assert.equal(autoHide.hidden.value, false, "the stale timer must not fire into the new session");
  } finally {
    mock.timers.reset();
  }
});
