# 贡献指南

欢迎贡献！请先阅读以下内容。

## 如何贡献

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/xxx`
3. 提交更改：`git commit -m 'feat: xxx'`
4. 推送到分支：`git push origin feature/xxx`
5. 提交 Pull Request

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

- `feat:` 新功能
- `fix:` 修复
- `docs:` 文档更新
- `style:` 格式调整
- `refactor:` 重构
- `test:` 测试

## 开发方向

- 增强看板 UI/UX
- 扩展岗位搜索覆盖范围
- 适配更多招聘系统（字节跳动自研、阿里自研、京东自研等）
- 添加更多数据可视化

## 注意事项

- 不要提交包含个人数据的 CSV 文件（已在 .gitignore 中）
- 不要提交 `config/` 目录下的用户配置文件（已在 .gitignore 中）
- 模板文件仅含表头，不含示例数据
- 保持零外部依赖（server.js 只用 Node.js 内置模块）
- 不使用 Playwright 或任何浏览器自动化库做爬虫
- 所有用户数据渲染前必须经过 `escapeHtml()` 转义
- 提交前运行冒烟测试：`npm test` 或 `node test/smoke-test.js`