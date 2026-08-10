# Context

Domain language for this repository. Single-context layout (see `docs/agents/domain.md`).

## Messaging

### 手写消息 (Handwriting Message)

A message whose `payload` stores stroke vector data — per character, normalized
coordinate points with timestamps — instead of an image or video. Recipients
replay the full writing animation on a canvas. Stored as a new `MessageType`
`handwriting`.

### 书写板 (Writing Pad)

The large square area in the handwriting composer where the user writes the
current character. One character is written at a time.

### 切字 (Commit Character)

Marking the character on the writing pad as finished: the character is appended
to the committed-character preview row and the pad clears for the next one.
Triggered **only by an explicit button tap** — no idle-timeout auto-commit and
no recognition-library detection (decision: half-written characters from
pauses must never be auto-committed). For the future Bible-copying feature the
target character is known, so exact completion detection (e.g. hanzi-writer
stroke matching) becomes available there.
