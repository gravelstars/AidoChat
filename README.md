<p align="center"><b>English</b> · <a href="README.zh.md">简体中文</a></p>

# AidoChat

<p align="center">
  <a href="https://github.com/gravelstars/AidoChat">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/social-night.png">
      <img src="docs/assets/social-day.png" alt="AidoChat" width="760">
    </picture>
  </a>
</p>

<p align="center">
  <strong>A warm and engaging local application for multi-AI group chats—open-source and free.</strong>
</p>

<p align="center">
  <img alt="Version 0.1.4" src="docs/assets/badge-version.svg">
  <img alt="Apache-2.0" src="docs/assets/badge-license.svg">
  <img alt="Windows · macOS · Linux" src="docs/assets/badge-platforms.svg">
</p>

<p align="center">
  <a href="https://github.com/gravelstars/AidoChat/releases/latest"><b>Download</b></a> ·
  <a href="https://gravelstars.github.io/AidoChat/"><b>Live demo</b></a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/USER_GUIDE.md">User guide</a> ·
  <a href="build/README.md">Build from source</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/main-night.png">
    <img src="docs/assets/main-day.png" alt="AidoChat with group list, conversation, and source-linked shared notes" width="920">
  </picture>
</p>

<p align="center"><sub>Screenshots use fictional data and preset replies from the browser demo.</sub></p>

## Why AidoChat

- **A group, not a single chat**: multiple AI members with their own roles and models share one timeline.
- **Proposals stay separate from decisions**: AI can only propose; only you can stamp a source-linked note as confirmed.
- **Local-first**: conversations, attachments, and notes live in local SQLite; API keys stay in the system credential store.
- **Your services, your choice**: OpenAI-compatible APIs, Anthropic, or a local Ollama model.
- **Bilingual interface**: Chinese by default, English optional. Switch anytime in **Settings → Interface language**.

## Download

Choose your platform and download **0.1.4**:

| Platform | Download | Install |
| --- | --- | --- |
| macOS 12+ (Intel / Apple Silicon) | [AidoChat.dmg](https://github.com/gravelstars/AidoChat/releases/download/v0.1.4/AidoChat.dmg) | Drag AidoChat.app into Applications |
| Windows 10 / 11 (x64) | [AidoChat-windows-setup.exe](https://github.com/gravelstars/AidoChat/releases/download/v0.1.4/AidoChat-windows-setup.exe) | Run the installer; WebView2 is required (the installer guides you) |
| Ubuntu 24.04 (amd64) | [AidoChat.deb](https://github.com/gravelstars/AidoChat/releases/download/v0.1.4/AidoChat.deb) | `sudo apt install ./AidoChat.deb` |
| Other Linux | [AidoChat.AppImage](https://github.com/gravelstars/AidoChat/releases/download/v0.1.4/AidoChat.AppImage) | `chmod +x` and run; requires GTK4 / WebKitGTK 6.0 |

[All releases and checksums](https://github.com/gravelstars/AidoChat/releases) · Not sure which one? Windows: setup.exe, macOS: dmg, Ubuntu: deb.

> macOS builds are ad-hoc signed and Windows builds are unsigned. Your system may ask you to confirm the source on first launch. Do not run files with the same name from untrusted sources. Quit any running AidoChat instance before installing or upgrading; the Windows installer detects and reports it.

## Features

<p align="center">
  <img src="docs/assets/feature-conversation.png" alt="Mention two members and choose sequential replies" width="760">
</p>

### Give the discussion an order
Mention one member, several, or everyone; choose sequential or parallel replies. Stop at any time, and retry a failed or interrupted reply in place.

<p align="center">
  <img src="docs/assets/feature-memory-comparison.png" alt="Dashed AI proposals, solid user proposals, and stamped decisions" width="840"><br>
  <img src="docs/assets/stamp.gif" alt="Clicking to stamp: the seal lands and ink spreads" width="240">
</p>

### Proposals and decisions look different
AI proposals use a dashed pencil line, your proposals use a solid ink line, and stamped decisions turn cinnabar. Source links jump back to the original message; AI cannot confirm on your behalf.

<p align="center">
  <img src="docs/assets/feature-papers.png" alt="Six papers: Xuan, Su, Ma, Qing, Ye, and Wujin" width="760">
</p>

### Six papers, one personal seal
Choose among six paper themes, reading sizes and density, a full display name, and a separate short seal. Member avatars can differ per group.

<p align="center">
  <img src="docs/assets/feature-privacy.png" alt="Demo service settings never accept a Key or contact a real model" width="560">
</p>

### Local records, services you choose
The desktop app uses local SQLite and the system credential store. Attach images, TXT/Markdown/PDF, Word/PowerPoint/Excel, CSV/JSON, code, and log files, and export a selected message range as paginated PNGs.


## Quick start

1. **Live demo**: open [gravelstars.github.io/AidoChat](https://gravelstars.github.io/AidoChat/) without a Key. Replies are preset and data stays in the current browser.
2. **Download the desktop app**: pick the installer for your platform from [Releases](https://github.com/gravelstars/AidoChat/releases/latest), or follow the [build instructions](build/README.md) to build from source.
3. **Configure a service**: add a base URL, Key, and an available model name in Settings or the member form.
4. **Start a discussion**: create a group, add members, and type `@墨白` or `@all`.

## Build from source

Requires Go (version in `go.mod`), Node.js 24, and the Wails build environment for your platform.

```sh
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.29
cd frontend && npm ci && cd ..
wails3 task package
```

Browser development preview:

```sh
cd frontend
npm ci
npm run dev
```

See [build/README.md](build/README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

> [!WARNING]
> Data is stored locally. When you call a cloud model, the mentioned member's context—group rules, shared notes, recent messages, and required attachment content—is sent to that member's configured model service. When notes are organized, new discussion is sent to the service configured for that task.

## Status

0.1.4 runs on the desktop, and macOS, Windows, and Linux installers are published on [Releases](https://github.com/gravelstars/AidoChat/releases/latest). The browser demo uses fictional data and preset replies. Mobile, accounts, cloud sync, web tools, scanned-PDF OCR, and video attachments are not supported. Windows/Linux installation still needs broader real-machine testing.

## Contributing

Report bugs and ideas through [Issues](https://github.com/gravelstars/AidoChat/issues). Development conventions and checks are in [CONTRIBUTING.md](CONTRIBUTING.md).

[Contribute](CONTRIBUTING.md) · [Apache-2.0](LICENSE) (third-party content retains its own terms; [third-party notices](THIRD_PARTY_NOTICES.md))
