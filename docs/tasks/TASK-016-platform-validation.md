# TASK-016 首次三平台 CI 验收修复

- 来源：所有者要求确保完整可运行，尽量确保 Windows/Linux 安装正确；2026-10-16 批准现有图标母版。
- 认领：Codex · 2026-10-16
- 依赖：TASK-015 已交付；GitHub 首次源码发布已完成。
- 分支：task/016-platform-validation

## 计划与验收

- [x] SQLite Windows 盘符路径回归先失败，再修复文件 URI，验证原有事务与重启测试。
- [x] 调查 macOS CI hdiutil Resource busy，保留真实失败记录，修正最小构建配方。
- [ ] 按已批准母版生成平台资源并验证安装包构建；不引入项目依赖或修改视觉造型。
- [ ] 三平台原生 CI 自检与打包通过；安装/GUI 真机限制仍明确标注。
- [ ] 更新交接/手册/收尾状态、校验归档和最新交付；保持源码目录干净。

## 调查记录 2026-10-16
- 首次 CI：https://github.com/rickepicepic/group-chat-ai/actions/runs/38913777806。
- Windows：sqlite invalid uri authority: C:，由 Go url.URL 把无开头斜杠的 Windows 盘符路径输出成 file://C:/... 导致。
- macOS：编译、签名、zip 均通过，hdiutil create 使用默认文件系统返回 Resource busy。
- Ubuntu：自检与 tar/deb 构建通过；首次图标未获批，AppImage 未构建。

## 修复与验证进度 2026-10-16
- URI 回归在修复前输出 file://C:/... 并失败；修复后盘符放入 /C:/ 路径，保留 URI 转义与连接参数。新增中文/空格/# 文件持久化回归，现有完整 Go 自检通过。
- macOS 显式使用 HFS+，对 Resource busy 最多尝试三次；其他失败立即退出。用独立假的 hdiutil 检查瞬时失败第三次成功、非忙碌错误一次即以原退出码失败。参考已有打包工具的同类忙碌处理：https://github.com/create-dmg/create-dmg/blob/master/create-dmg；不把 CI 环境原因写作已确认的系统故障。
- 已按所有者批准设置仓库变量 APP_ICON_APPROVED=true，下一轮 CI 生成现有母版图标并构建 AppImage。
