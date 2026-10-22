# Assistant functions

The function registry is the shared source for the model protocol, discovery results and the administrator's **AI settings → 功能调用** directory. The administrator controls one switch and a per-answer limit of 1–12 calls (default 8). No individual function setup is needed.

## Current capabilities

| Function | Result |
| --- | --- |
| `discover_functions` | Search the live registered directory. |
| `open_feature` | An application-generated button opening an existing user interface. |
| `read_scripture`, `search_scripture` | Read or search the local Bible. |
| `search_music` | Search the live music/score catalog with validated IDs. |
| `search_books` | Search public book metadata; no personal progress or notes. |
| `search_current_channel` | Read bounded messages in the question's channel, up to that question. |
| `list_friend_programs` | Read the current friend-radio program feed. |

Feature buttons cover Bible, books, music, scores, friend radio, message search, favorites, prayer, grace, stories, handwriting, chains, sermons, members, channels and usage help. Opening a feature presents its existing controls for the user to operate; it does not claim that the user's operation has completed. Music, scripture and copied score results retain the existing validated message formats.

## Registering a new capability

Add a focused adapter through `registry.register` in `src/server/services/assistantChatFunctions.ts`, using a strict Zod schema, a user-facing description and bounded output. New registrations automatically appear in the model's next request, discovery and the settings directory. To add a feature button, extend the typed `ASSISTANT_FEATURES` catalog and its existing-interface handler in `App.vue` / `AssistantFeatureLauncher.vue`; TypeScript requires a matching handler. Neither change requires an administrator to enable individual features.

A new HTTP route alone does not grant AI access. Its service adapter must define the permitted inputs and output; avoid passing raw request objects or model-supplied URLs to application routes. Read adapters return data. Presentation adapters return application-owned messages; the model cannot forge feature payloads or resource IDs in ordinary text.

## Conversation and permission boundaries

The server supplies account, channel, trigger-message and assistant IDs. Model arguments cannot change this context. Every invocation checks current channel access, the enabled role, private-conversation ownership and the durable stop boundary. Queries use this scope rather than IDs supplied by the model.

Public music queries and final score sharing accept only the public music catalog. Account-owned virtual-role private chats retain the requesting user's standalone-score permissions. Channel-message queries do not cross into other conversations. Book queries expose public metadata only.

The registry accepts read and presentation capabilities. Deletion, recall, channel exit, logout, account administration and deployment operations are excluded. Future adapters must preserve these boundaries and the original user's permissions.

Registered calls and legacy `search_music` requests share one per-answer budget. The latter also retains its four-search cap for compatibility. Turning off functions during generation blocks subsequent calls and pending feature/resource publication; ordinary prose may still be sent. User stop commands continue to suppress pending answers independently.

## Validation

The matching registry, route, catalog, reply and private-assistant tests cover authorization, strict inputs, discovery, shared limits and changes while a reply is pending. `e2e/tests/virtual-role-conversations.spec.ts` exercises settings persistence, feature-card rendering, the usage-help modal and final-space opt-outs through HTTP and the real composer/socket path, using an offline model and disposable MySQL fixtures.
