<p align="center"><img src="public/icon.svg" width="56" height="56" alt="Minorminor icon" /></p>
<h1 align="center">Minorminor</h1>
<p align="center"><strong>See what takes space. Choose what goes.</strong><br />Inspect files, projects and AI tools on your Mac. Review a preview before cleanup.</p>

<p align="center">
  <a href="package.json"><img src="assets/readme/badges/version.svg" alt="Development preview 0.1.0" /></a>
  <a href="#get-started"><img src="assets/readme/badges/macos.svg" alt="For macOS" /></a>
  <a href="package.json"><img src="assets/readme/badges/node.svg" alt="Requires Node.js 22 or later" /></a>
  <a href="LICENSE"><img src="assets/readme/badges/license.svg" alt="Minorminor license GPL-3.0" /></a>
  <a href="https://github.com/tw93/Mole/blob/6650d0958282aa8052cd2bfeee15f67b17fe613b/LICENSE"><img src="assets/readme/badges/mole.svg" alt="Mole engine license GPL-3.0" /></a>
</p>
<p align="center"><a href="README.md">简体中文</a> · <strong>English</strong> · <a href="https://github.com/Ray-hola/Minorminor-Rust">Rust Application</a></p>
<p align="center">Integrates the <a href="https://github.com/tw93/Mole">Mole</a> submodule · Thanks to <a href="https://github.com/tw93">Tw93</a> and contributors</p>
<p align="center"><a href="#get-started">Get started</a> · <a href="docs/usage.md">Full guide (Chinese)</a> · <a href="#development">Development</a></p>

![Project cleanup: storage, caches, logs, sessions and memory](assets/readme/project-cleanup.en.jpg)
<p align="center"><sub>Actual interface with isolated sample projects and files.</sub></p>

## What it does

| Feature | What you can inspect and control |
| --- | --- |
| **One scan** | Background traversal updates file categories, folder sizes, project storage and tool discovery. |
| **Browse deeper** | Expand folders and files; distinguish caches, logs, sessions, memory and retained data. |
| **Clean by project** | Select a scope, review individual files, confirm, then inspect per-file results. |
| **Optional AI** | Analyze metadata or summarize a file or folder you explicitly select. |

**Editions:** This repository independently maintains Minorminor **Web (Node.js backend)**. The [**Rust Application**](https://github.com/Ray-hola/Minorminor-Rust) has its own repository, entry points, APIs, records and versions.

## Get started

Requires **macOS, Git and Node.js 22+**. No npm dependencies or global Mole installation are needed.

```sh
git clone --recurse-submodules https://github.com/Ray-hola/Minorminor.git
cd Minorminor
npm start
```

Open **<http://127.0.0.1:4783>**, or double-click **`start.command`** to launch. Press `Ctrl+C` in the terminal to stop the service.

Choose **简体中文 / English** in the sidebar. Your choice is saved in the current browser. File names, paths, content and raw command output keep their original language.

**Scan → browse → select → preview and confirm.** Reloading or navigating does not interrupt background scanning. This is the **v0.1.0 development preview**; no Release installer is available.

<details>
<summary>Port busy, or the Mole submodule missing?</summary>

Use `PORT=4784 npm start`, then open <http://127.0.0.1:4784>.

If you cloned without submodules, run in the project directory:

```sh
git submodule update --init --recursive
```

</details>

## Cleanup and AI

- **Preview, then confirm.** Visual cleanup permanently deletes selected caches and logs. Project cleanup moves files to Trash. Advanced full Mole cleanup may empty Trash. Each entry point states its scope and impact.
- **AI analysis cannot read document content.** It uses metadata and structural evidence. AI summaries read a bounded sample only after you select the resource and confirm sending it to your configured model. Folder summaries show their sampling scope.
- **A model is optional.** Local Ollama and compatible APIs are supported. Scanning and cleanup work independently. Tool detection may be incomplete; uncertain and unreadable items are marked.

The service binds only to loopback. Scan records and connection settings live in the Git-ignored `.runtime/` directory. API keys stay in service memory. See the [full guide (Chinese)](docs/usage.md) for cleanup scope and recovery details.

## Development

The interface and language catalog are in [`public/`](public/). Scanning and cleanup logic are in [`lib/`](lib/); [`server.mjs`](server.mjs) is the service entry point.

```sh
npm run check
npm test
```

Tests use temporary fixtures. See the [development guide (Chinese)](docs/usage.md#修改与验证) for directory responsibilities. Report problems through [Issues](https://github.com/Ray-hola/Minorminor/issues).

## License and acknowledgements

Minorminor is licensed under [GNU GPL-3.0](LICENSE) (`GPL-3.0-only`). Bundled IBM Plex fonts retain the [SIL Open Font License 1.1](public/fonts/OFL.txt).

This project includes **Mole as a Git submodule** at [`vendor/mole/`](https://github.com/tw93/Mole/tree/6650d0958282aa8052cd2bfeee15f67b17fe613b), providing part of its disk cleanup functionality.

- **Mole project: [https://github.com/tw93/Mole](https://github.com/tw93/Mole)**
- Pinned version and provenance: [UPSTREAM.json](UPSTREAM.json). Upstream code is unchanged, with its [GPL-3.0 license](https://github.com/tw93/Mole/blob/6650d0958282aa8052cd2bfeee15f67b17fe613b/LICENSE) and copyright notices preserved.

Thank you to **[Tw93](https://github.com/tw93)** and **[all Mole contributors](https://github.com/tw93/Mole/graphs/contributors)** for the open source cleanup tools and implementation reference that support this project.
