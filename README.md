<p align="center">
  <img src="public/icon.svg" width="56" height="56" alt="Minorminor 折纸图标" />
</p>

<h1 align="center">Minorminor</h1>

<p align="center">
  <strong>看清占用，再决定清理。</strong><br />
  在 Mac 上查看文件、项目与 AI 工具占用，预览并确认后再处理。
</p>

<p align="center">
  macOS · Node.js 22+ · 开发预览 v0.1.0
</p>

<p align="center">
  <a href="#开始使用">开始使用</a> ·
  <a href="docs/usage.md">完整说明</a> ·
  <a href="#开发">开发</a>
</p>

![Minorminor 项目清理：查看项目占用，区分缓存、日志、会话和记忆](assets/readme/project-cleanup.jpg)

<p align="center"><sub>实际界面，使用独立的示例项目与文件。</sub></p>

## 可以做什么

| 功能 | 你能看到与操作的内容 |
| --- | --- |
| **一次扫描** | 后台扫描，同步更新文件分类、目录大小、项目占用与 AI 工具数据。 |
| **项目占用** | 展开文件和文件夹，区分缓存、日志、会话、记忆与保留文件。 |
| **逐项清理** | 勾选范围，审阅具体文件，确认处理，查看逐文件结果。 |
| **可选 AI** | 辅助识别工具与文件用途；为点选的文件或文件夹生成概括。 |

## 开始使用

需要 **macOS、Git 和 Node.js 22+**。无需安装 npm 依赖，也无需全局安装 Mole。

```sh
git clone --recurse-submodules https://github.com/Ray-hola/Minorminor.git
cd Minorminor
npm start
```

打开 **<http://127.0.0.1:4783>**。也可以双击项目里的 `start.command` 启动，终端中按 `Ctrl+C` 停止服务。

**扫描 → 展开查看 → 勾选范围 → 预览并确认。** 刷新页面或切换页面不会中断后台扫描。

<details>
<summary>端口占用，或 Mole 子模块为空？</summary>

端口占用时运行 `PORT=4784 npm start`，打开 <http://127.0.0.1:4784>。

如果克隆时遗漏子模块，在项目目录运行：

```sh
git submodule update --init --recursive
```

</details>

## 清理与 AI 的边界

- **清理前需要确认。** 可视化清理会永久删除所选缓存和日志；项目清理移到废纸篓；高级 Mole 整次清理可能包含废纸篓。每个入口都展示具体范围与影响。
- **AI 分析不读文档正文。** 仅使用元数据与结构特征；「AI 总结」在你点选范围并确认后，才抽读内容并发送至所配置的模型。文件夹总结会标明抽读范围。
- **模型连接可选。** 支持本机 Ollama 与兼容接口；扫描和清理可独立使用。工具识别可能不完整，不确定或无法读取的内容会明确标记。

服务仅监听本机。扫描记录和连接配置保存在被 Git 忽略的 `.runtime/`；API Key 仅保留在当前服务内存。更多范围、保留规则与恢复说明见 [完整说明](docs/usage.md)。

## 开发

界面在 [`public/`](public/)，扫描与清理逻辑在 [`lib/`](lib/)，服务入口为 [`server.mjs`](server.mjs)。

```sh
npm run check
npm test
```

测试使用临时样例。目录职责与实现细节见 [开发说明](docs/usage.md#修改与验证)；反馈可提交至 [Issues](https://github.com/Ray-hola/Minorminor/issues)。

## 上游与许可

Mole 提供部分清理能力，原样以固定版本子模块保存；来源见 [UPSTREAM.json](UPSTREAM.json)，沿用 [GPL-3.0](https://github.com/tw93/Mole/blob/6650d0958282aa8052cd2bfeee15f67b17fe613b/LICENSE)。Minorminor 与 Mole 官方应用无隶属关系。

新增 Web UI 尚未单独指定许可证；内置 IBM Plex 字体沿用 [SIL Open Font License 1.1](public/fonts/OFL.txt)。
