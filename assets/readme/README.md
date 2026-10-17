# 截图来源

`project-cleanup.jpg` 与 `project-cleanup.en.jpg` 分别展示简体中文和 English，来自实际运行的 Minorminor 项目清理页，使用独立临时目录内的 Atlas、Paper、Notes 示例项目。界面显示的大小由扫描生成，未使用真实用户文件或模型连接。

更新截图时，在仓库根目录运行：

```sh
node assets/readme/demo.mjs
```

打开 <http://127.0.0.1:4785/#projects>，搜索 Atlas。截取完整页头与项目分类，保存为 `project-cleanup.jpg`。在侧栏切换 English，以相同范围保存 `project-cleanup.en.jpg`。按 `Ctrl+C` 停止并删除本次示例数据。示例文件与运行记录均位于临时目录，Mole 命令与外部模型调用已关闭。

`badges/` 为本地静态 SVG：版本来自 `package.json`，系统要求来自 `native/Info.plist`，Rust 要求来自 `native/Cargo.toml`，Mole 许可来自 `UPSTREAM.json`；主项目许可尚未指定。修改这些事实时同步更新徽章与两个 README，不使用静态通过标记代替 CI 结果。
