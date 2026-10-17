# TASK-019 实施计划

所有者已批准2026-10-17体验设计所列契约扩展。仅实施用户显示名和独立短印文，不改受保护印章或设计文件。

1. 先以 app/user_profile_test.go 验证旧库默认、Unicode/空白控制字符校验、资料保存及数据库失败不留半份设置；frontend/src/lib/userProfile.test.ts 验证英文缩写、中文建议与不截断校验；store.test.ts 验证失败保持旧资料。保留 RED 日志。
2. app/dto.go 新增 UserProfile 与 Bootstrap.userDisplayName；app/user_profile.go 校验及调用现有 SetSettings 原子保存，service.go Bootstrap 读取旧设置默认值，保留 SetUserSeal 兼容并收紧空白印文验证。
3. 同步 contract.ts、wails.ts、mock.ts、store.ts，新增 Promise 型显式 setUserProfile；成功才更新可见资料，失败向表单抛错。
4. SettingsView.tsx 保留独立显示名/印文/印式草稿，显式建议与保存，保存失败保留草稿、组字不触发提交；使用现有 UserSeal 预览32/64/112px。MessageItem 使用当前显示名与头像标签，消息作者ID不变。
5. 运行针对测试后完整 Go vet/race、前端测试/build、保护指纹检查、diff检查；主执行者负责原生六纸/最小尺寸/平台预览和发布验收。交付记录明确尚未验证部分。
