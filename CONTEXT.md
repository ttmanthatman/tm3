# Context

Domain language for this repository. Single-context layout (see `docs/agents/domain.md`).

## Messaging

### 手写消息 (Handwriting Message)

A message whose `payload` stores stroke vector data — per character, normalized
coordinate points with timestamps — instead of an image or video. Recipients
replay the full writing animation on a canvas. Stored as a new `MessageType`
`handwriting`. Limited to 30 characters per message.

In the timeline it renders as the finished static writing; when the message
arrives in real time the animation plays once automatically, and tapping
replays it. Replay follows recorded timestamps but compresses pauses longer
than ~1s down to ~0.5s.

### 书写板 (Writing Pad)

The large square area in the handwriting composer where the user writes the
current character. One character is written at a time; committed characters
appear as small cells in a preview row above the pad.

### 切字 (Commit Character)

Marking the character on the writing pad as finished: the character is appended
to the preview row and the pad clears for the next one. Triggered **only by an
explicit button tap** — no idle-timeout auto-commit and no recognition-library
detection (half-written characters from pauses must never be auto-committed).

### 笔画撤销 / 整字删除 (Undo Stroke / Delete Character)

Editing inside the handwriting composer: "undo one stroke" steps back within
the current character; tapping a committed character removes it. No
rewrite-in-place — rewriting means delete and write again.

## Bible

### 圣经抄写 (Bible Copying)

Selecting a passage in the Bible reader and handwriting it character by
character (reference character shown above a blank pad — plain copying, no
tracing outline). Submitting produces a 手写消息 sent to the current channel,
with the scripture reference (book/chapter/verses/version) attached in the
message payload. Because the target character is known in this flow, exact
stroke-level completion detection (e.g. hanzi-writer) remains an option here
even though free messages use manual commit only.
