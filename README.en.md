English · [简体中文](README.md)

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-night.svg"><img src="docs/assets/banner-day.svg" alt="AidoChat — Bring AI into one group. Put decisions on record." width="800"></picture></p>

<p align="center">Mention members. Trace shared notes. Stamp your decisions.</p>
<p align="center"><img alt="Version 0.1.2" src="docs/assets/badge-version.svg"> <img alt="Apache-2.0" src="docs/assets/badge-license.svg"> <img alt="Windows · macOS · Linux" src="docs/assets/badge-platforms.svg"></p>
<p align="center"><a href="docs/DEMO.md">Try the demo (setup pending)</a> · <a href="#download">Download</a> · <a href="docs/USER_GUIDE.md">Docs</a></p>

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/main-night.png"><img src="docs/assets/main-day.png" alt="Groups, messages, and shared notes with both confirmed decisions and AI proposals" width="800"></picture></p>

### Give the discussion an order

<img src="docs/assets/feature-conversation.png" alt="Mention two members, choose sequential replies, and see who is speaking or waiting" width="480">

Each member has a role and a model. Mention one, several, or everyone; choose sequential or parallel replies, stop a turn, or retry a reply in place.

### Keep proposals distinct from decisions

<img src="docs/assets/feature-memory-comparison.png" alt="Dashed AI proposals, solid user proposals, and red stamped confirmations" width="640">

Each group keeps its own notes, with sources linking back to messages. AI proposals, your proposals, and your confirmed decisions stay distinct; AI cannot confirm on your behalf.

<a href="docs/assets/stamp.gif"><img src="docs/assets/stamp.gif" alt="An actual confirmation click: the stamp lands and ink spreads, three seconds" width="230"></a> [Static first frame](docs/assets/stamp-first.png)

### Local records, services you choose

<img src="docs/assets/feature-privacy.png" alt="Demo service settings explicitly explain that no API Key is accepted and no real model is contacted" width="380">

The desktop app stores data locally and Keys in your system credential store. Use OpenAI-compatible services, Anthropic, or Ollama; attach images and TXT/Markdown/text PDFs, and export a selected message range as paginated PNGs.

### Get started in thirty seconds

1. [Try preset replies and stamping](docs/DEMO.md), without a Key (Pages setup pending).
2. Install the desktop app when public installers are released.
3. Add a model service, Key, and an available model name in Settings or the member form.
4. Create a group, add members, and type `@墨白` to start.

### Download

Windows: installers coming soon.<br>
macOS: installers coming soon.<br>
Linux: installers coming soon.<br>
[Download and demo status](docs/DEMO.md) · [Build from source](build/README.md)

### Pick your paper and personal seal

<img src="docs/assets/feature-papers.png" alt="Six papers: Xuan, Su, Ma, Qing, Ye, and Wujin" width="800">

Choose among six papers, reading sizes and density, a full display name, a separate short seal, and image avatars. Member avatars can vary by group.

> [!WARNING]
> Data is stored locally. When you call a cloud model, the mentioned member's context—group rules, shared notes, recent messages, and required attachment content—is sent to the model service you configured. When notes are organized, new discussion is sent to the service configured for that task.

### Status and next steps

The 0.1.2 desktop app runs locally; these screenshots use fictional browser-demo data and preset replies. Mobile is not supported; cloud sync, web tools, and scanned-PDF OCR are unavailable, and Windows/Linux installation still needs testing on real machines. Cross-platform validation comes next; see [current status](docs/CLOSEOUT.md).

[Contribute](CONTRIBUTING.md) · [Apache-2.0](LICENSE) (third-party content retains its own terms; [items requiring review](THIRD_PARTY_NOTICES.md))
