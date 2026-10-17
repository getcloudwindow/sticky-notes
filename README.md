# Sticky Notes for Cloud Window

Quick notes in the menu bar, and a window to write and sort them.

- **Option+Shift+N** starts a note from anywhere on your computer.
- The **Notes** menu in the menu bar lists your newest notes; choose one to open it.
- The **Sticky Notes** window holds all of them: six colours, pinning, search, and checklists (start a line with `[ ] `).
- Notes are kept on your computer, so every device you open it from sees the same notes.

## Install

Open [getcloudwindow.com/plugins](https://getcloudwindow.com/plugins) and choose **Install** under Sticky Notes, or paste this repository's address into **Preferences → Plugins → From GitHub** on your computer.

## How it works

Sticky Notes is a Cloud Window plugin with an app window:

- `provider.mjs` runs in the plugin sandbox. It keeps the notes in one file in the plugin's own data folder, draws the menu bar item and answers the window.
- `app/` is the window. Cloud Window shows it in a sandboxed frame with no network access; it talks only to `provider.mjs`, through `cloudwindow.request` and `cloudwindow.on`.

It asks for two grants: adding a menu bar item, launcher actions and a shortcut (`extend:write`), and opening its own window (`desktop:act`). It connects to no internet hosts.

## License

MIT. Copyright © 2026 Seeking Gradient LLC.
