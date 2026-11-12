<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-vue-next";
import AppModal from "../../components/ui/AppModal.vue";
import ConfirmDialog from "../../components/ui/ConfirmDialog.vue";
import { api } from "../../api";
import { useChatStore } from "../../store";
import { calendarHolidays, type HolidayCategory } from "./calendarHolidays";
import "./calendarTheme.css";
import {
  calendarInputSchema,
  wallTime,
  wallTimeToDate,
  type CalendarEventDTO,
  type CalendarInput
} from "../../../shared/calendar";
const props = defineProps<{ channelId: number; date?: string }>();
const emit = defineEmits<{ close: [] }>();
const store = useChatStore();
const today = () => wallTime(new Date(), zone).slice(0, 10);
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const selectedDate = ref(props.date ? wallTime(new Date(props.date), zone).slice(0, 10) : today());
const month = ref(selectedDate.value.slice(0, 7));
const filter = ref("visible");
const categories = [
  { id: "community", label: "我们的日程" },
  { id: "church", label: "教会节日" },
  { id: "hebrew", label: "犹太历节期" },
  { id: "china", label: "中国节假日" }
] as const;
type CalendarCategory = HolidayCategory | "community";
const selectedCategories = ref<CalendarCategory[]>(categories.map((item) => item.id));
function toggleCategory(id: CalendarCategory) {
  selectedCategories.value = selectedCategories.value.includes(id)
    ? selectedCategories.value.filter((value) => value !== id)
    : [...selectedCategories.value, id];
}
const events = ref<CalendarEventDTO[]>([]);
const members = ref<Array<{ id: number; displayName: string }>>([]);
const roles = ref<Array<{ id: number; name: string }>>([]);
const manager = ref(false),
  canCreate = ref(false);
const role = ref<{ id: number | null; name: string; fallback: boolean }>({
  id: null,
  name: "日历",
  fallback: false
});
const error = ref(""),
  loading = ref(false),
  saveBusy = ref(false),
  previewBusy = ref(false);
const editorOpen = ref(false),
  deleteOpen = ref(false),
  current = ref<CalendarEventDTO | null>(null);
const start = ref(""),
  end = ref(""),
  until = ref(""),
  offsetText = ref("0"),
  optionText = ref("");
const editScope = ref<"all" | "one" | "future">("all");
const formError = ref(""),
  previewNote = ref("");
const form = ref<CalendarInput>(blank());
let generation = 0;
function blank(): CalendarInput {
  return {
    title: "",
    description: "",
    startAt: "",
    endAt: "",
    timeZone: zone,
    allDay: false,
    visibility: "private",
    memberIds: [],
    repeat: "none",
    weekdays: [],
    untilAt: null,
    reminders: [0],
    reminderMode: "private",
    reminderText: "",
    publicReminderConfirmed: false,
    chainConfig: null,
    paused: false
  };
}
const channelName = computed(
  () => store.channels.find((c) => c.id === props.channelId)?.name || "群"
);
const cells = computed(() => {
  const first = new Date(`${month.value}-01T12:00:00`);
  const begin = new Date(first);
  begin.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(begin);
    d.setDate(begin.getDate() + i);
    return wallTime(d, zone).slice(0, 10);
  });
});
const filtered = computed(() =>
  filter.value === "mine"
    ? events.value.filter((e) => e.ownerAccountId === store.account?.id)
    : events.value
);
function onDay(e: CalendarEventDTO, day: string) {
  const first = wallTime(new Date(e.occurrenceAt!), zone).slice(0, 10),
    last = wallTime(new Date(e.occurrenceEndAt!), zone).slice(0, 10);
  return first <= day && last >= day;
}
const visibleEvents = computed(() => selectedCategories.value.includes("community") ? filtered.value : []);
const holidays = computed(() => calendarHolidays(cells.value[0], cells.value[41]));
const visibleHolidays = computed(() => holidays.value.filter((event) => selectedCategories.value.includes(event.category)));
const dayHolidays = computed(() => visibleHolidays.value.filter((event) => event.date === selectedDate.value));
const dayEvents = computed(() => visibleEvents.value.filter((e) => onDay(e, selectedDate.value)));
function dayCategories(day: string) {
  return categories.filter((category) => category.id === "community"
    ? visibleEvents.value.some((event) => onDay(event, day))
    : visibleHolidays.value.some((event) => event.date === day && event.category === category.id));
}
function categoryLabel(id: HolidayCategory) {
  return categories.find((category) => category.id === id)!.label;
}
function moveMonth(delta: number) {
  const d = new Date(`${month.value}-01T12:00:00`);
  d.setMonth(d.getMonth() + delta);
  month.value = wallTime(d, zone).slice(0, 7);
  selectedDate.value = `${month.value}-01`;
}
async function load() {
  const ticket = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const from = wallTimeToDate(`${cells.value[0]}T00:00`, zone).toISOString();
    const last = new Date(`${cells.value[41]}T12:00:00`);
    last.setDate(last.getDate() + 1);
    const to = wallTimeToDate(`${wallTime(last, zone).slice(0, 10)}T00:00`, zone).toISOString();
    const result = await api<{
      events: CalendarEventDTO[];
      members: typeof members.value;
      roles: typeof roles.value;
      manager: boolean;
      canCreate: boolean;
      role: typeof role.value;
    }>(
      `/api/channels/${props.channelId}/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&manage=${filter.value === "manage"}`
    );
    if (ticket !== generation) return;
    events.value = result.events;
    members.value = result.members;
    roles.value = result.roles;
    manager.value = result.manager;
    canCreate.value = result.canCreate;
    role.value = result.role;
  } catch (cause) {
    if (ticket === generation)
      error.value = cause instanceof Error ? cause.message : "日历读取失败";
  } finally {
    if (ticket === generation) loading.value = false;
  }
}
watch([month, () => props.channelId, () => filter.value === "manage"], load, { immediate: true });
onBeforeUnmount(() => {
  generation++;
});
function openEditor(event: CalendarEventDTO | null) {
  current.value = event;
  form.value = event ? JSON.parse(JSON.stringify({ ...blank(), ...event })) : blank();
  editScope.value = event?.repeat !== "none" ? "one" : "all";
  start.value = event
    ? wallTime(new Date(event.occurrenceAt!), event.timeZone)
    : `${selectedDate.value}T09:00`;
  end.value = event
    ? wallTime(new Date(event.occurrenceEndAt!), event.timeZone)
    : `${selectedDate.value}T10:00`;
  until.value = event?.untilAt
    ? wallTime(new Date(event.untilAt), event.timeZone).slice(0, 10)
    : "";
  offsetText.value = (event?.reminders || [0]).join(",");
  optionText.value = event?.chainConfig?.options.join("\n") || "";
  formError.value = "";
  previewNote.value = "";
  editorOpen.value = true;
}
function inputValue() {
  const f = form.value;
  const data = {
    ...blank(),
    title: f.title,
    description: f.description,
    timeZone: f.timeZone,
    allDay: f.allDay,
    visibility: f.visibility,
    memberIds: f.memberIds,
    repeat: f.repeat,
    weekdays: f.weekdays,
    paused: f.paused,
    reminderMode: f.reminderMode,
    reminderText: f.reminderText,
    publicReminderConfirmed: f.publicReminderConfirmed,
    chainConfig: f.chainConfig
      ? {
          ...f.chainConfig,
          options: optionText.value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
        }
      : null,
    startAt: wallTimeToDate(
      f.allDay ? `${start.value.slice(0, 10)}T00:00` : start.value,
      f.timeZone
    ).toISOString(),
    endAt: wallTimeToDate(
      f.allDay ? `${end.value.slice(0, 10)}T23:59:59` : end.value,
      f.timeZone
    ).toISOString(),
    untilAt: until.value
      ? wallTimeToDate(`${until.value}T23:59:59`, f.timeZone).toISOString()
      : null,
    reminders: offsetText.value.split(/[,，]/).map((s) => Number(s.trim()))
  };
  const result = calendarInputSchema.safeParse(data);
  if (!result.success) throw new Error(result.error.issues[0].message);
  if (current.value?.repeat !== "none" && editScope.value === "all" && current.value) {
    // Whole-series edits preserve the series anchor rather than moving it to the selected occurrence.
    const anchor = wallTime(new Date(current.value.startAt), f.timeZone).slice(0, 10);
    const duration = Date.parse(result.data.endAt) - Date.parse(result.data.startAt);
    result.data.startAt = wallTimeToDate(
      `${anchor}T${wallTime(new Date(result.data.startAt), f.timeZone).slice(11)}`,
      f.timeZone
    ).toISOString();
    result.data.endAt = new Date(Date.parse(result.data.startAt) + duration).toISOString();
  }
  return result.data;
}
async function save() {
  if (saveBusy.value || !canEdit.value) return;
  saveBusy.value = true;
  formError.value = "";
  try {
    const value = inputValue();
    await api(
      `/api/channels/${props.channelId}/calendar${current.value ? `/${current.value.id}` : ""}`,
      {
        method: current.value ? "PUT" : "POST",
        body: JSON.stringify(
          current.value
            ? {
                value,
                revision: current.value.revision,
                scope: editScope.value,
                occurrenceAt: current.value.occurrenceAt
              }
            : value
        )
      }
    );
    editorOpen.value = false;
    await load();
  } catch (cause) {
    formError.value = cause instanceof Error ? cause.message : "保存失败";
  } finally {
    saveBusy.value = false;
  }
}
const canEdit = computed(() => (current.value ? current.value.canManage : canCreate.value));
async function remove() {
  if (!current.value || saveBusy.value) return;
  saveBusy.value = true;
  formError.value = "";
  try {
    await api(`/api/channels/${props.channelId}/calendar/${current.value.id}`, {
      method: "DELETE",
      body: JSON.stringify({
        revision: current.value.revision,
        scope: editScope.value,
        occurrenceAt: current.value.occurrenceAt
      })
    });
    deleteOpen.value = false;
    editorOpen.value = false;
    await load();
  } catch (cause) {
    formError.value = cause instanceof Error ? cause.message : "删除失败";
  } finally {
    saveBusy.value = false;
  }
}
async function changeRole(event: Event) {
  const selected = (event.target as HTMLSelectElement).value;
  saveBusy.value = true;
  error.value = "";
  try {
    await api(`/api/channels/${props.channelId}/calendar-role`, {
      method: "PUT",
      body: JSON.stringify({ actorId: selected ? Number(selected) : null })
    });
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "角色设置失败";
  } finally {
    saveBusy.value = false;
  }
}
async function polish() {
  previewBusy.value = true;
  formError.value = "";
  previewNote.value = "";
  try {
    const result = await api<{ text: string; fallback: boolean }>(
      `/api/channels/${props.channelId}/calendar-preview`,
      {
        method: "POST",
        body: JSON.stringify({ text: form.value.reminderText || `提醒大家：${form.value.title}` })
      }
    );
    form.value.reminderText = result.text;
    if (result.fallback) previewNote.value = "暂时无法润色，已保留原文，可直接编辑。";
  } catch (cause) {
    formError.value = cause instanceof Error ? cause.message : "预览失败";
  } finally {
    previewBusy.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <AppModal
      open
      size="medium"
      class="calendar-overlay"
      content-class="calendar-panel"
      :title="`${channelName} · 日历`"
      close-label="关闭日历"
      @close="emit('close')"
    >
      <div class="calendar-scroll">
        <div class="calendar-toolbar">
          <button class="icon-btn" aria-label="上个月" @click="moveMonth(-1)">
            <ChevronLeft :size="19" />
          </button>
          <strong>{{ month.replace("-", " 年 ") }} 月</strong>
          <button class="icon-btn" aria-label="下个月" @click="moveMonth(1)">
            <ChevronRight :size="19" />
          </button>
          <button
            class="mini-btn secondary"
            @click="
              selectedDate = today();
              month = selectedDate.slice(0, 7);
            "
          >
            今天
          </button>
          <button v-if="canCreate" class="primary-btn calendar-create" @click="openEditor(null)">
            <Plus :size="16" />新建日程
          </button>
        </div>
        <div class="calendar-filters">
          <label
            >群内日程
            <select v-model="filter">
              <option value="visible">全部可见</option>
              <option value="mine">我创建的</option>
              <option v-if="manager" value="manage">管理全部</option>
            </select></label
          ><small v-if="loading" role="status">正在读取…</small>
        </div>
        <div class="calendar-categories" role="group" aria-label="日历分类">
          <button
            v-for="category in categories"
            :key="category.id"
            type="button"
            class="calendar-category"
            :class="`category-${category.id}`"
            :aria-pressed="selectedCategories.includes(category.id)"
            @click="toggleCategory(category.id)"
          ><i aria-hidden="true" />{{ category.label }}</button>
        </div>
        <p v-if="error" role="alert" class="error">
          {{ error }} <button class="mini-btn secondary" @click="load">重试</button>
        </p>
        <div class="calendar-grid">
          <span
            v-for="day in ['一', '二', '三', '四', '五', '六', '日']"
            :key="day"
            class="calendar-weekday"
            >{{ day }}</span
          >
          <button
            v-for="day in cells"
            :key="day"
            class="calendar-day"
            :class="{
              selected: day === selectedDate,
              outside: !day.startsWith(month),
              today: day === today()
            }"
            :aria-label="`${day}${dayCategories(day).length ? ` 有${dayCategories(day).map((category) => category.label).join('、')}` : ''}`"
            :aria-pressed="day === selectedDate"
            @click="selectedDate = day"
          >
            <span>{{ Number(day.slice(-2)) }}</span
            ><span class="calendar-day-markers" aria-hidden="true"><i v-for="category in dayCategories(day)" :key="category.id" :class="`category-${category.id}`" /></span>
          </button>
        </div>
        <h3>{{ selectedDate }} 的日程</h3>
        <p v-if="!dayEvents.length && !dayHolidays.length && !loading" class="calendar-muted">这一天还没有可见日程。</p>
        <button
          v-for="event in dayEvents"
          :key="`${event.id}-${event.occurrenceAt}`"
          class="calendar-event"
          @click="openEditor(event)"
        >
          <span
            ><strong>{{ event.title }}</strong
            ><small class="calendar-event-category category-community">我们的日程</small><small
              >{{
                event.allDay
                  ? "全天"
                  : new Date(event.occurrenceAt!).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit"
                    })
              }}
              · {{ event.ownerName }} ·
              {{ { private: "仅自己", members: "指定成员", group: "全群" }[event.visibility]
              }}{{ event.paused ? " · 已暂停提醒" : "" }}</small
            ></span
          ><CalendarDays :size="18" />
        </button>
        <article v-for="holiday in dayHolidays" :key="holiday.id" class="calendar-event calendar-holiday">
          <span><strong>{{ holiday.title }}</strong>
            <small class="calendar-event-category" :class="`category-${holiday.category}`">{{ categoryLabel(holiday.category) }}</small>
            <small>{{ holiday.description }}</small>
          </span><CalendarDays :size="18" aria-hidden="true" />
        </article>
        <p class="calendar-muted calendar-holiday-note">教会节日按公历西方教会日期；犹太历节期从前一日日落开始。节日日期供参考，中国放假调休以官方公告为准。</p>
        <p v-if="selectedCategories.includes('china') && (Number(month.slice(0, 4)) < 1901 || Number(month.slice(0, 4)) > 2100)" class="calendar-muted">中国农历节日与清明日期支持 1901—2100 年，当前年份暂无这些节日数据。</p>
        <div class="calendar-role">
          <label v-if="manager"
            >群提醒角色
            <select :value="role.id || ''" :disabled="saveBusy" @change="changeRole">
              <option value="">日历</option>
              <option v-for="item in roles" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select></label
          ><small v-else>群提醒角色：{{ role.name }}</small
          ><small v-if="role.fallback">原角色不可用，当前回退为「日历」。</small>
        </div>
      </div>
    </AppModal>
    <AppModal
      :open="editorOpen"
      size="medium"
      class="calendar-overlay calendar-editor"
      content-class="calendar-panel"
      :title="current ? '日程详情' : '新建日程'"
      :busy="saveBusy || previewBusy"
      close-label="关闭日程详情"
      @close="editorOpen = false"
    >
      <form class="calendar-scroll calendar-form" @submit.prevent="save">
        <fieldset :disabled="!canEdit || saveBusy || previewBusy">
          <label>标题<input v-model="form.title" maxlength="160" required /></label>
          <label>说明<textarea v-model="form.description" rows="3" maxlength="5000" /></label>
          <label class="calendar-check"><input v-model="form.allDay" type="checkbox" />全天</label>
          <div class="calendar-two">
            <label>开始时间<input v-model="start" type="datetime-local" required /></label
            ><label>结束时间<input v-model="end" type="datetime-local" required /></label>
          </div>
          <label>时区<input v-model="form.timeZone" required /></label>
          <label
            >可见范围<select
              v-model="form.visibility"
              @change="form.publicReminderConfirmed = false"
            >
              <option value="private">仅自己</option>
              <option value="members">指定成员</option>
              <option value="group">全群</option>
            </select></label
          >
          <small v-if="form.visibility !== 'group'"
            >管理员仍可管理此日程；私人提醒只发给日程创建者。</small
          >
          <div v-if="form.visibility === 'members'" class="calendar-members">
            <label v-for="member in members" :key="member.id" class="calendar-check"
              ><input v-model="form.memberIds" type="checkbox" :value="member.id" />{{
                member.displayName
              }}</label
            >
          </div>
          <div class="calendar-two">
            <label
              >重复<select v-model="form.repeat">
                <option value="none">不重复</option>
                <option value="daily">每天</option>
                <option value="weekly">每周指定星期</option>
              </select></label
            ><label v-if="form.repeat !== 'none'"
              >重复截止日期<input v-model="until" type="date"
            /></label>
          </div>
          <div v-if="form.repeat === 'weekly'" class="calendar-weekdays">
            <label
              v-for="(name, index) in ['日', '一', '二', '三', '四', '五', '六']"
              :key="index"
              class="calendar-check"
              ><input v-model="form.weekdays" type="checkbox" :value="index" />{{ name }}</label
            >
          </div>
          <label
            >提醒方式<select
              v-model="form.reminderMode"
              @change="form.publicReminderConfirmed = false"
            >
              <option value="private">私密提醒框，仅提醒我</option>
              <option value="off">不提醒</option>
              <option value="text">群普通消息</option>
              <option value="chain">群接龙消息</option>
            </select></label
          >
          <template v-if="form.reminderMode !== 'off'">
            <label
              >提前多少分钟提醒<input
                v-model="offsetText"
                placeholder="例如：0,10,1440"
                required
              /><small>0 表示开始时；多个时间用逗号分隔，最多 5 个。</small></label
            >
            <p v-if="form.reminderMode === 'private'" class="calendar-muted">
              到时在聊天室内弹出提醒，无需浏览器通知权限。关闭网页后，下次进入可查看待确认提醒。
            </p>
            <template v-else>
              <label
                >公开提醒正文<textarea
                  v-model="form.reminderText"
                  rows="3"
                  maxlength="3000"
                  required
                />
              </label>
              <button
                type="button"
                class="mini-btn secondary"
                :disabled="previewBusy"
                @click="polish"
              >
                按「{{ role.name }}」的口吻润色</button
              ><small v-if="previewNote" role="status">{{ previewNote }}</small>
              <small
                >预览即上面的正文，发送时另附本次日程时间与时区；私密说明不会出现在群消息中。</small
              >
              <label v-if="form.visibility !== 'group'" class="calendar-check"
                ><input
                  v-model="form.publicReminderConfirmed"
                  type="checkbox"
                />我确认提醒正文和日程时间将对全群公开</label
              >
              <template v-if="form.reminderMode === 'chain'">
                <label class="calendar-check"
                  ><input
                    type="checkbox"
                    :checked="!!form.chainConfig"
                    @change="
                      form.chainConfig = ($event.target as HTMLInputElement).checked
                        ? { requiredSelection: true, allowMultiple: false, options: [] }
                        : null
                    "
                  />接龙需要选择项目</label
                >
                <template v-if="form.chainConfig"
                  ><label>接龙选项，每行一个<textarea v-model="optionText" rows="3" /></label
                  ><label class="calendar-check"
                    ><input
                      v-model="form.chainConfig.allowMultiple"
                      type="checkbox"
                    />允许多选</label
                  ></template
                >
                <small>每次活动独立接龙，同一次活动的后续提醒引用原接龙。</small>
              </template>
            </template>
            <label class="calendar-check"
              ><input v-model="form.paused" type="checkbox" />暂停此日程提醒</label
            >
          </template>
          <label v-if="current && current.repeat !== 'none'"
            >修改或删除范围<select v-model="editScope">
              <option value="one">仅本次</option>
              <option value="future">本次及以后</option>
              <option value="all">整个系列</option>
            </select></label
          >
        </fieldset>
        <p v-if="formError" role="alert" class="error">{{ formError }}</p>
        <div v-if="canEdit" class="calendar-actions">
          <button
            v-if="current"
            type="button"
            class="mini-btn danger"
            :disabled="saveBusy"
            @click="deleteOpen = true"
          >
            删除日程</button
          ><button class="primary-btn" :disabled="saveBusy || previewBusy">
            {{ saveBusy ? "正在保存…" : "保存日程" }}
          </button>
        </div>
      </form>
    </AppModal>
    <ConfirmDialog
      :open="deleteOpen"
      class="calendar-overlay calendar-confirm"
      title="删除日程？"
      message="将取消所选范围内尚未发送的提醒。已发送到群里的消息保留。"
      confirm-text="删除"
      :busy="saveBusy"
      :error="formError"
      danger
      @close="deleteOpen = false"
      @confirm="remove"
    />
  </Teleport>
</template>

<style scoped>
.calendar-overlay {
  z-index: 2000;
}
.calendar-editor {
  z-index: 2001;
}
.calendar-confirm {
  z-index: 2002;
}
:deep(.calendar-panel) {
  display: flex;
  flex-direction: column;
  width: min(760px, 100%);
  max-height: calc(
    var(--app-height, 100dvh) - 32px - var(--safe-top, 0px) - var(--safe-bottom, 0px)
  );
}
:deep(.calendar-panel > .modal-head) {
  flex-shrink: 0;
}
.calendar-scroll {
  padding: 16px;
  overflow: auto;
  min-height: 0;
  overscroll-behavior: contain;
}
.calendar-toolbar,
.calendar-filters,
.calendar-role,
.calendar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.calendar-create {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}
.calendar-filters {
  margin: 12px 0;
}
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 3px;
}
.calendar-weekday {
  text-align: center;
  font-size: 12px;
  color: #8a6a76;
  padding: 5px;
}
.calendar-day {
  position: relative;
  min-height: 44px;
  border: 0;
  border-radius: 8px;
  background: #fff5ed;
  color: #553c49;
  cursor: pointer;
}
.calendar-day.selected {
  background: #a34e65;
  color: white;
}
.calendar-day.outside {
  opacity: 0.5;
}
.calendar-day.today span {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.calendar-day-markers {
  display: flex;
  justify-content: center;
  gap: 3px;
  min-height: 4px;
  margin: 3px auto 0;
}
.calendar-day-markers i {
  display: block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--category-color);
}
.calendar-day.selected i {
  outline: 1px solid #fff7ee;
}
.category-community { --category-color: #a65038; --category-tint: #fbe6d9; }
.category-church { --category-color: #7854a3; --category-tint: #eee6f6; }
.category-hebrew { --category-color: #326b91; --category-tint: #e1edf7; }
.category-china { --category-color: #a83e59; --category-tint: #fbe2e8; }
.calendar-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0;
}
.calendar-category, .calendar-event small.calendar-event-category {
  color: var(--category-color);
  background: var(--category-tint);
  border-radius: 6px;
  font-size: 12px;
}
.calendar-category {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 36px;
  padding: 5px 9px;
  border: 1px solid var(--category-color);
  cursor: pointer;
}
.calendar-category[aria-pressed="false"] {
  background: transparent;
  border-color: #d8c4cb;
  color: #806775;
}
.calendar-category i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--category-color);
}
.calendar-category[aria-pressed="false"] i { background: #ad9ba5; }
.calendar-event small.calendar-event-category {
  display: inline-block;
  padding: 2px 6px;
}
.calendar-event.calendar-holiday { cursor: default; }
.calendar-holiday-note { font-size: 12px; }
.calendar-event {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  text-align: left;
  padding: 12px;
  margin: 8px 0;
  border: 1px solid #ead0ce;
  background: #fff9f3;
  border-radius: 10px;
  cursor: pointer;
}
.calendar-event span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.calendar-event small,
.calendar-role small {
  display: block;
  color: #806775;
  margin-top: 5px;
}
.calendar-muted {
  color: #806775;
  font-size: 13px;
  line-height: 1.6;
}
.calendar-role {
  border-top: 1px solid #ead0ce;
  padding-top: 12px;
  margin-top: 18px;
}
.calendar-form fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 12px;
  min-width: 0;
}
.calendar-form label {
  display: grid;
  gap: 6px;
  font-size: 14px;
  min-width: 0;
}
.calendar-form input:not([type="checkbox"]),
.calendar-form textarea,
.calendar-form select {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 9px;
  border: 1px solid #dcbfc7;
  border-radius: 7px;
  font: inherit;
  background: #fffaf6;
  color: #553c49;
}
.calendar-form .calendar-check {
  display: flex;
  align-items: center;
  gap: 7px;
  line-height: 1.5;
}
.calendar-two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.calendar-members {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  max-height: 160px;
  overflow: auto;
}
.calendar-weekdays {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.calendar-form small {
  color: #806775;
  line-height: 1.6;
}
.calendar-actions {
  justify-content: flex-end;
  margin-top: 16px;
}
.calendar-actions .danger {
  margin-right: auto;
}
@media (max-width: 480px) {
  .calendar-two {
    grid-template-columns: minmax(0, 1fr);
  }
  .calendar-scroll {
    padding: 12px;
  }
  .calendar-toolbar strong {
    font-size: 14px;
  }
  .calendar-create {
    font-size: 12px;
  }
}
</style>
