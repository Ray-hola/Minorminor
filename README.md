<p align="center"><img src="public/icon.svg" width="56" height="56" alt="Minorminor 图标" /></p>
<h1 align="center">Minorminor</h1>
<p align="center"><strong>看清占用，再决定清理。</strong><br />在 Mac 上查看文件、项目与 AI 工具占用，预览并确认后再处理。</p>

<p align="center">
  <a href="package.json"><img src="assets/readme/badges/version.svg" alt="开发预览 0.2.0" /></a>
  <a href="docs/desktop.md#运行要求"><img src="assets/readme/badges/macos.svg" alt="macOS 12 或更新版本" /></a>
  <a href="native/Cargo.toml"><img src="assets/readme/badges/rust.svg" alt="源码构建需要 Rust 1.88 或更新版本" /></a>
  <a href="#上游与许可"><img src="assets/readme/badges/license.svg" alt="Minorminor 尚未指定许可证" /></a>
  <a href="https://github.com/tw93/Mole/blob/6650d0958282aa8052cd2bfeee15f67b17fe613b/LICENSE"><img src="assets/readme/badges/mole.svg" alt="Mole 引擎许可证 GPL-3.0" /></a>
</p>
<p align="center"><strong>简体中文</strong> · <a href="README.en.md">English</a></p>
<p align="center"><a href="#开始使用">开始使用</a> · <a href="docs/desktop.md">桌面版说明</a> · <a href="#开发">开发</a></p>

![项目清理：查看项目大小、缓存、日志、会话和记忆](assets/readme/project-cleanup.jpg)
<p align="center"><sub>实际 Web 界面，使用独立的示例项目。桌面版沿用相同视觉风格。</sub></p>

## 可以做什么

| 功能 | 你能看到与操作的内容 |
| --- | --- |
| **一次扫描** | 后台遍历，同步更新文件分类、文件夹大小、项目占用和工具识别。 |
| **逐层查看** | 展开目录与文件，区分缓存、日志、会话、记忆与保留内容。 |
| **按项目整理** | 勾选范围，审阅具体文件，确认处理，查看逐文件去向。 |
| **可选 AI** | 根据元数据辅助判读，为你点选的文件或文件夹生成总结。 |

## 开始使用

源码运行需要 **macOS 12+、Git、Rust 1.88+ 与 Xcode Command Line Tools**，无需全局安装 Mole。

```sh
git clone --recurse-submodules https://github.com/Ray-hola/Minorminor.git
cd Minorminor
./scripts/run-native.sh
```

也可以双击 **`start.command`**。首次启动会编译 Rust 程序，之后打开独立窗口。侧栏的「语言」可切换 **简体中文 / English**，选择会保存。

**扫描 → 展开查看 → 勾选范围 → 预览并确认。** 切换页面不会中断后台扫描。

当前是 **v0.2.0 开发预览**，尚未提供 Release 安装包。本机 `.app` 构建方式见 [桌面版说明](docs/desktop.md)；构建产物无需 Node.js 或 Rust 运行环境，仅做 ad-hoc 签名，未经过 Apple Developer ID 签名或公证。

<details>
<summary>继续使用浏览器版</summary>

需要 Node.js 22+，无需安装 npm 依赖：

```sh
npm run web
```

打开 <http://127.0.0.1:4783>；端口占用时使用 `PORT=4784 npm run web`。原浏览器版的完整操作与实现说明见 [Web 说明（中文）](docs/usage.md)。两个入口的扫描记录独立保存。

</details>

## 清理与 AI

- **先预览，再确认。** 桌面版只把审阅后的文件移到废纸篓，保留逐文件记录；Mole 的高级命令仅预览。浏览器版的可视化清理和 Mole 整次清理涉及永久删除，确认弹窗会说明范围。
- **AI 分析不读文档正文。** 仅使用元数据与结构特征；「AI 总结」在你点选范围并确认后，才抽读内容并发送至所配置的模型。
- **模型连接可选。** 支持本机 Ollama 与兼容接口；扫描和整理可独立使用。不确定或无法读取的内容会标明。

服务仅监听本机。桌面版记录位于 `~/Library/Application Support/com.minorminor.desktop/`，浏览器版位于项目的 `.runtime/`。API Key 只保存在当前进程内存中。文件名、路径、正文与原始命令输出保留原文，不随界面语言翻译。

## 开发

| 目录 | 职责 |
| --- | --- |
| [`native/`](native/) | Rust 扫描、索引、清理与 macOS 窗口 |
| [`public/`](public/) | 共享样式、桌面与浏览器界面、中英文文案 |
| [`lib/`](lib/) · [`server.mjs`](server.mjs) | 浏览器版引擎与本地服务 |
| [`vendor/mole/`](https://github.com/tw93/Mole/tree/6650d0958282aa8052cd2bfeee15f67b17fe613b) | 固定提交的 Mole 子模块 |

```sh
npm run check
npm test
cargo test --locked --manifest-path native/Cargo.toml --no-default-features
./scripts/build-macos.sh
```

Web 检查需要 Node.js 22+；Rust 测试使用临时样例，构建产物不提交。发现问题可提交至 [Issues](https://github.com/Ray-hola/Minorminor/issues)。

## 上游与许可

Mole 原样保存为固定版本子模块，来源见 [UPSTREAM.json](UPSTREAM.json)，沿用 [GPL-3.0](https://github.com/tw93/Mole/blob/6650d0958282aa8052cd2bfeee15f67b17fe613b/LICENSE)。Minorminor 与 Mole 官方应用无隶属关系。

**Minorminor 新增代码尚未单独指定许可证**，公开源码不代表已授予自由复用许可；内置 IBM Plex 字体沿用 [SIL Open Font License 1.1](public/fonts/OFL.txt)。徽章展示实际授权与源码版本，不代表正式发行或 Apple 认证。
