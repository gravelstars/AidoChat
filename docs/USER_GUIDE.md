# AidoChat User Guide

Version 0.1.4 · Last updated 2026-10-19

English · [简体中文](USER_GUIDE.zh.md)

AidoChat is a local AI group chat application. Put AI members with different models and roles into the same group, mention them with `@`, discuss, and turn useful conclusions into source-linked shared notes.

The browser demo and the desktop app are separate modes and do not share data. Demo replies are preset and never call a model. Desktop installers are published on [GitHub Releases](https://github.com/gravelstars/AidoChat/releases/latest).

## 1. First run: follow this order

1. Launch the desktop app.
2. On the welcome screen, choose **Configure members and model services**, or open **Members → New member** at the bottom left. Enter a name and a role prompt.
3. If there is no service yet, choose **New model service** inside the member form. Select an endpoint, enter the API Key and the actual test model name, test the connection, and save. Local services without authentication may leave the Key empty.
4. Saving the service returns to the member draft and selects the service automatically. Confirm the model name and save the member. Services can also be managed later in **Settings**.
5. Create a second member with a different role.
6. Choose **New group** in the sidebar, give it a name, invite both members, and select **Sequential** or **Parallel** replies.
7. Type `@青砚 @墨白 Please review this plan from implementation and experience angles`, replacing the names with your own members, then send.
8. After the discussion, choose **Organize** in the notes panel and check the sources. **Stamp** the items you actually accept.

A fresh install has no built-in real services or members. If you see a set of ready-made demo groups, first check whether you opened the browser mock preview.

## 2. Install and launch

### Download from Releases

Download **0.1.4** from [Releases](https://github.com/gravelstars/AidoChat/releases/latest):

| Platform | File | Install |
| --- | --- | --- |
| macOS 12+ (Intel / Apple Silicon) | `AidoChat.dmg` | Open the dmg and drag `AidoChat.app` into Applications |
| Windows 10 / 11 (x64) | `AidoChat-windows-setup.exe` | Run the installer; WebView2 is required and the installer guides you |
| Ubuntu 24.04 (amd64) | `AidoChat.deb` | `sudo apt install ./AidoChat.deb` |
| Other Linux | `AidoChat.AppImage` | `chmod +x AidoChat.AppImage` and run; requires GTK4 / WebKitGTK 6.0 |

- The macOS package is universal for Intel and Apple Silicon. It is ad-hoc signed, not Developer ID signed or notarized; on first launch you may need to confirm the source under **Privacy & Security**.
- The Windows installer installs to `%LOCALAPPDATA%\ai-group-chat` and creates an AidoChat shortcut. Quit any running AidoChat or older version before installing or upgrading.
- If Windows reports a file-write error or offers **Ignore**, close AidoChat and run the installer again. Do not choose **Ignore**; the main executable may not be installed.
- Linux packages are built on Ubuntu 24.04 in CI. Other distributions must provide GTK4 / WebKitGTK 6.0.
- A fresh install has no service or member. Configure a model service as described below. Data stays local; API Keys use the system credential store.

Older versions, checksums, and platform notes are listed under [All releases](https://github.com/gravelstars/AidoChat/releases).

### Run the desktop app from source

You need Go (version in `go.mod`, currently 1.26.4), Node.js 24 / npm, and the native desktop build tools. macOS requires Xcode Command Line Tools. First-time setup:

```sh
cd AidoChat  # your local checkout; older folders may still be named group-chat-ai
npm --prefix frontend ci
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.29
```

Make sure Go's bin directory is on `PATH`, then run from the project root:

```sh
wails3 dev
```

Development mode starts the frontend and opens the real desktop window. To build a full installer, run `wails3 task package` in the same directory. See [build/README.md](../build/README.md) for platform details.

### Browser demo only

```sh
cd AidoChat  # your local checkout; older folders may still be named group-chat-ai
npm --prefix frontend ci
npm --prefix frontend run dev
```

Open `http://localhost:5173`. This runs the mock backend with demo data; it cannot verify real APIs, SQLite, or the system credential store. `?platform=windows` only changes the layout preview.

## 3. Configure model services

Open **Settings → Model services → New service**.

| Field | What to enter |
| --- | --- |
| Name | Anything recognizable, such as your cloud service or local model |
| Type | Choose **OpenAI-compatible** for most Chat Completions services; use the Anthropic type for the Anthropic API |
| Endpoint | The provider's API endpoint, not its marketing homepage. Presets are shortcuts only |
| API Key | Enter it in the password field. After saving, only whether it is configured is shown; the value is never displayed |
| Test model | A model name enabled on your account and supported by this endpoint. Do not copy another provider's model name |

A successful connection test means that one service and model request succeeded. It does not guarantee every model, future quota, or network condition. Model names differ between providers. A test model is required; AidoChat no longer guesses a default model from the service type. When editing, the model used by an existing member is filled in first. Changing connection parameters clears old test results, and the fields are locked while testing.

When editing a service, leave the API Key empty to keep the existing Key. If you switch provider or account, update the endpoint, type, Key, and model together. A service still referenced by members cannot be deleted; update those members first.

Local Ollama and other unauthenticated services may leave the Key empty, but you must start the service and install the model first. Enter the actual local compatible API endpoint and an installed model name. A "no API Key saved" note does not mean a local service is unusable.

Keys are stored in the system credential store. If the system asks for access, allow the current app. Without permission, a locked keychain, or a missing credential, real calls will fail. A new service does not automatically inherit credentials manually stored under another provider ID; re-enter and save the Key in the new service.

## 4. Create and manage members

Open **Members → New member**. If no service exists, create one directly in the member form; the member draft is preserved. When no members exist, the new-group dialog also offers a member-creation entry and selects the new member after saving.

- A name is 1–12 characters, cannot contain whitespace or `@`, and must be unique. It is used for mentions.
- The one-line brief describes the member's role so other members know what it is good at.
- The role prompt only enters that member's own system prompt. For example: `You review code, point out edge cases first, and suggest the smallest safe change.`
- The model service and model name must match.
- The context budget controls how much history can fit into one request. It is not a promise that all messages are remembered forever.
- Temperature may be left empty to use the service default. If set manually, it must be within the model's supported range.

After saving a member, click the avatar in the editor to change its default avatar. The default applies to every group without a per-group override. Click a member's avatar in the group header and edit **Group avatar** to change only that group. Restore the default to remove the override.

PNG/JPEG/GIF/WebP are supported, up to 8 MiB each. Images are copied into the app's avatar directory unchanged. GIF playback in multiple places still needs interactive verification.

Renaming a member affects future mentions and the displayed name in history. Deleting a member removes it from every group, while historical messages keep their identity. Deletion or member changes are refused while a reply is running; stop the turn first.

## 5. Group chat, mentions, and reply modes

The order in which members are invited to a new group is also the order used for `@everyone` replies. **Manage** in the group header changes the group name, topic, default mode, and member order.

| Input / action | Behavior |
| --- | --- |
| Plain text without `@` | Only recorded in the group; no AI is called |
| `@Member` | Only the mentioned member replies |
| Multiple mentions | Generated in the selected sequential or parallel mode |
| `@everyone` | Mentions every current group member in group order |
| `@` inside AI text | Does not trigger other AIs and never causes an automatic loop |

**Sequential**: each later member sees the completed replies earlier in the same turn. Good for review, additions, and cross-checking.

**Parallel**: members answer independently and cannot see each other's replies from the same turn. Good for collecting independent opinions. Choosing a mode in the composer only affects the current send and does not change the group default.

A group can have only one active turn at a time; different groups can run independently. You can keep editing the composer while a turn runs, but that group must wait until the turn ends before sending again.

### Stop and retry

- Choose **Stop** or press `Ctrl/⌘ + .` to stop the current group's turn.
- Generated content is preserved, and queued placeholders are marked as stopped.
- For a failed reply choose **Retry**; for an interrupted reply choose **Regenerate**. The old content is cleared in place, and message IDs and counts stay unchanged.
- Retry is unavailable while the same group is replying. Completed normal replies do not show the retry action.
- A normal exit waits for replies to settle. On an abnormal exit, stream fragments not yet persisted may be lost; after restart, leftover in-progress messages are marked as stopped.

### Source numbers

Messages use per-group numbers such as `#1`, `#2`. "Read through #N" on an AI message means the last message included in the context when it was generated; history may still be trimmed by the budget, so it does not mean every earlier message was read in full.

### Chat attachments

Choose **Add attachment** in the composer, or paste or drop images into it. Each message supports up to 4 attachments:

| Type | Limit | What is sent to the model |
| --- | --- | --- |
| PNG / JPEG / WebP | ≤10 MiB each, ≤40 million pixels | The original image, only when the mentioned member has **Image input** enabled |
| TXT / Markdown / CSV / JSON / code / logs | ≤20 MiB, UTF-8, ≤100,000 characters | Locally read text with message number and file name; JSON must be valid |
| PDF | ≤20 MiB, ≤100 pages, ≤100,000 characters | Locally extracted page text; scanned PDFs are not OCRed |
| Word (`.docx`) | ≤20 MiB, ≤100,000 characters | Locally extracted paragraph text |
| PowerPoint (`.pptx`) | ≤20 MiB, ≤100,000 characters | Locally extracted text from each slide |
| Excel (`.xlsx`) | ≤20 MiB, ≤100,000 characters | Locally extracted text from every worksheet |

Attachments stay in the local data directory and are never uploaded to a third party. Only mentioned members receive the attachment content for that turn. Whether images are sent depends on **Image input** in member settings. If it is off, sending images to that member is rejected and the draft is kept; AidoChat will not pretend the model saw an image. Text from the documents above enters the real request with source information. Note organization reads only that text and never sends original images.

A failed send keeps the draft so you can retry; the draft is cleared only after a successful send. Unsent drafts are removed when you switch groups or close the app. **Preview** shows images and locally extracted document text.

## 6. Shared notes and stamping

The notes panel contains background, plans, decisions, and tasks. Each item has an `M1`, `M2`, etc. number and links to real message sources.

| State | Meaning |
| --- | --- |
| AI proposal | Suggested by a model and not yet confirmed by you |
| Your proposal · awaiting stamp | Comes from the user discussion but is not yet confirmed in the notes |
| Confirmed | Created by your stamp in the interface; AI cannot confirm, rewrite, or replace it |
| Rejected / done | Kept for the record and moved to its section |

Automatic organization checks after each turn whether enough new visible messages exist (currently at least 8 messages or about 2,500 tokens). You can also choose **Organize** directly. A large backlog is processed in windows; one run does not necessarily organize all history.

In **Settings → Note organization** you can choose the service and model. **Use a group member's service** follows the first available member and does not set a separate model. With a specific service, enter a model actually available on it; changing services clears the old model name. New discussion is sent to that model service during organization.

Recommended flow: read the item, click its source number to check the original, then decide whether to stamp it. Hovering a source highlights the corresponding chat message; clicking jumps to it.

- **Stamp**: confirm a conclusion.
- **Reject**: keep a rejected record and reduce repeated suggestions.
- **Edit**: you rewrite the text; a user edit counts as a user proposal.
- Undo confirmation/rejection: return to pending.
- Task checkbox: mark done or undo completion. Undoing returns it to pending, ready to stamp again.

No new items after organizing is not necessarily a failure: there may be no new discussion, or the model may judge nothing worth recording. A model request or JSON parse failure does not advance the cursor. "Organization finished" does not mean every piece of content has been reliably stored.

## 7. Group management, appearance, and copying

Group settings change the topic, default mode, members, and speaking order; changes are written as system messages. Removed members keep their historical messages.

The group menu in the sidebar can archive or delete. Archiving only hides the group; it can still be opened from **Archived**. Deleting removes the chat and notes with no in-app undo.

Appearance settings offer Xuan, Su, Ma, Qing, Ye, and Wujin papers, day/night/follow-system mode, text size, and layout density. The personal seal supports 1–4 characters in white-on-red or red-on-paper style and is also used for confirmed note items.

**Settings → Interface language** switches between Chinese (default) and English. The interface, common backend errors, and newly created system messages follow the selected language; existing messages keep the language they were written in. Group names, member names, prompts, and model output are your content and are never translated automatically.

Code blocks support highlighting and **Copy**; code without a language tag keeps its block formatting. Message text can be copied in full. Actual clipboard behavior depends on the system WebView permissions; full native clipboard verification is still pending.

### Share image

The group header has a **Share image** entry. Choose the start and end messages (inclusive), the paper (current or Xuan), and whether to show the group name, time, and AidoChat signature. Then preview and save.

- Content longer than one page is paginated to the real page body, up to 20 images. Each PNG is exactly 1080 wide. Long code lines wrap, and tables repeat their header with a **continued** marker on later pages.
- Saving opens the system directory picker. Images go into a new subfolder named `group-date-short-id`; existing files are never overwritten. The folder name is shown when saving finishes.
- A share image contains the group name, date, speaker names and seals, optional time, message text, attachment names/images, and page numbers. It never includes model names, service names, local paths, or extracted attachment text.
- Historical messages from removed members show **Removed member**. In-progress messages cannot be selected.
- Share images are never uploaded automatically; generation and saving happen locally.

## 8. Data location, backup, and restore

Open **Settings → Data** to see the real database directory and open the file manager.

| System | Default data directory |
| --- | --- |
| macOS | `~/Library/Application Support/ai-group-chat/` |
| Windows | `%APPDATA%\ai-group-chat\` |
| Linux | `~/.config/ai-group-chat/`; follows `XDG_CONFIG_HOME` when set |

After the rename, AidoChat continues to use the `ai-group-chat` data directory and credential service so existing chats and Keys are neither migrated nor reset. Windows keeps the old install directory name for upgrade compatibility; the interface and program name are AidoChat.

The main files are `data.db` (SQLite), `avatars/` (avatars), and `window.json` (window state). API Keys live in the system keychain, not in the database.

**Backup**: stop generation and organization, exit normally, wait for the app to finish, then copy the entire data directory. Copying only `data.db` while the app is running may miss changes in the WAL.

**Restore**: exit the app, back up the current data directory, then put the previous backup back in place. On a new computer or system, re-enter the Keys in the restored model services; copying only the database does not migrate the system keychain.

Source code, process archives, and user data are three different things. Cleaning `node_modules`, `dist`, or historical screenshots does not delete chats; backing up source code does not back up chats either.

## 9. FAQ

| Symptom | Check first |
| --- | --- |
| Demo groups appear but settings do nothing | Did you start only the browser mock? Real use requires the desktop window |
| No AI reply after sending | Did you correctly `@` a current group member, and has the name changed? |
| 401/403 | Whether the Key, account permission, endpoint, and model match; whether system credential access was allowed |
| 404 / unsupported parameter | A homepage instead of an API endpoint, wrong path, another provider's model name, or an unsupported parameter |
| 429 | Provider quota or rate limit |
| Connection / stream timeout | Whether the service is running and the network is healthy; whether a local model is installed and ready |
| A local service without a Key still warns | Confirm it truly needs no authentication; leave the Key empty and try a real connection |
| Cannot delete a model service | Members still use it. Update those members or delete them. Historical data from deleted members no longer blocks retirement |
| Want to change a stamped note | Use user edit or undo confirmation; AI itself cannot change confirmed items |
| Settings disappear after restart | Different system user, run mode, or data directory; browser demo data is not desktop data |
| `wails3` not found | Check that the pinned CLI is installed and Go's bin directory is on `PATH` |
| Port 5173 is in use | Stop the old dev server using that port; the project uses a strict port |

## 10. Shortcuts and current limits

- `Enter` sends; `Shift + Enter` inserts a newline.
- `Ctrl/⌘ + .` stops the current turn.
- In the mention menu, use the arrow keys to move, `Enter`/`Tab` to confirm, and `Esc` to close.
- Input-method composition protection for Enter is implemented; real IME verification is still pending.

AidoChat does not provide accounts, cloud sync, cross-group personal memory, AI-triggered AI conversations, web search, or code execution. Attachments currently support images, TXT/Markdown/PDF, Word/PowerPoint/Excel, CSV/JSON, code, and logs; scanned-PDF OCR and video are not supported. Whether an attachment is visible to a model depends on whether the member is mentioned and on its **Image input** setting.
