# Halo 商店上架材料

本文档汇总 `halo-private-posts` 发布到 Halo 应用市场所需的最小材料，基于 `2026-04-29` 的仓库状态整理。

## 当前仓库版本与公开发布状态

- 插件名：`halo-private-posts`
- 仓库当前版本：`1.0.1`
- 当前公开 Release 版本：`1.0.0`
- 当前公开 Git tag：`v1.0.0`
- Halo 兼容范围：`>=2.24.0`
- GitHub 仓库：`https://github.com/BairongLuo/halo-private-posts`
- 当前公开 GitHub Release：`https://github.com/BairongLuo/halo-private-posts/releases/tag/v1.0.0`
- 当前公开 JAR 下载：`https://github.com/BairongLuo/halo-private-posts/releases/download/v1.0.0/halo-private-posts-1.0.0.jar`
- 当前公开校验文件：`https://github.com/BairongLuo/halo-private-posts/releases/download/v1.0.0/SHA256SUMS`
- 当前公开 SHA256：`c6568280d503136e6c308720dfe8b1d7b00b2c62ec08f13cfaad1eb21005678b`

## Halo 官方流程

根据 Halo 官方文档，当前应用市场的新应用提交流程是：

1. 向 `halo-sigs/awesome-halo` 发起 PR，提交应用信息。
2. 如需上架到 Halo 应用市场，在 PR 中勾选“上架到 Halo 应用市场”。
3. 如需后续自行管理应用和版本，在 PR 描述中提供 Halo 官网用户名。
4. 等官方审核通过并完成首次上架。
5. 拿到应用管理权限后，再接自动同步发布。

## 当前已满足的要求

- `plugin.yaml` 已正确设置 `logo`、`homepage`、`issues`、`license`。
- 仓库已存在非默认图标：`src/main/resources/logo.svg`。
- 仓库已提供介绍、使用和运维文档：
  - `README.md`
  - `docs/OPERATIONS.md`
  - `docs/SMOKE_TEST.md`
- 当前公开版本 `v1.0.0` 已完成 GitHub Release，且包含 JAR 与 `SHA256SUMS`。

## 仍需补充的信息

- Halo 官网用户名：用于上架后转交应用管理权限。
- 商店截图：官方文档没有硬性格式要求，但实际提审时建议准备文章列表状态、编辑页加密入口、前台解锁页等真实截图。
- 如需提交 `1.0.1`，先发布对应 Release，再替换下方 PR 文案里的版本号、下载链接和 SHA256。

## 已补充的仓库元数据

- GitHub Topics 已设置：`halo-plugin`

## awesome-halo README 条目草案

建议添加到 `README.md` 的“插件 / 社区”分组：

```md
- [halo-private-posts](https://github.com/BairongLuo/halo-private-posts) - 为 Halo 提供加密正文、浏览器本地解密和自动重锁的私密文章插件。
```

## awesome-halo PR 文案草案

```md
#### 仓库地址

https://github.com/BairongLuo/halo-private-posts

#### 应用市场

- [x] 上架到 [Halo 应用市场](https://www.halo.run/store/apps)

#### Halo 官网用户名

TODO: 填写你的 Halo 官网用户名

#### 补充说明

- 插件名称：Halo Private Posts
- 当前版本：v1.0.0
- 兼容 Halo：>=2.24.0
- Release：https://github.com/BairongLuo/halo-private-posts/releases/tag/v1.0.0
- 下载地址：https://github.com/BairongLuo/halo-private-posts/releases/download/v1.0.0/halo-private-posts-1.0.0.jar
- SHA256：c6568280d503136e6c308720dfe8b1d7b00b2c62ec08f13cfaad1eb21005678b
- 简介：为 Halo 提供加密正文、浏览器本地解密和自动重锁的私密文章插件。

```release-note
新增社区插件 halo-private-posts，提供文章正文加密、浏览器本地解密、自动重锁与后台口令恢复能力。
```
```

## 商店条目建议文案

- 显示名称：`Halo Private Posts`
- 简短描述：`为 Halo 提供加密正文、浏览器本地解密和自动重锁的私密文章插件。`
- 详细描述：`文章仍然使用 Halo 原生 Post 流程，标题、slug 和摘要保持公开，正文以加密 bundle 保存在文章注解中；读者输入访问密码后在浏览器本地解密，离开页面、切后台或空闲超时后会自动重新锁定。`
- 适用场景：`付费内容预览后加锁、活动文章密码访问、内部资料临时共享、原生文章流内的私密正文托管。`

## 拿到商店权限后的自动发布

官方文档建议在拿到应用管理权限后，再把 GitHub Release 和 Halo 商店发布打通。当前仓库的 `release.yml` 只负责构建 JAR、生成校验和创建 GitHub Release，还没有接入 Halo 官方应用市场发布 action。按当前仓库结构，后续最短路径是：

1. 保留现有 `release.yml` 的构建与附件上传步骤。
2. 在 GitHub Release `published` 事件上新增商店同步 workflow。
3. 接入 Halo 官方应用市场发布 action，并补充 `app-id`。
4. 在 GitHub Secrets 中设置 `HALO_PAT`。
5. 如果采用官方示例里的 `skip-appstore-release: true` 模式，再把它去掉，或显式设为 `false`。

## 提交前自检清单

- 目标提交版本的 Release 页面可正常下载 JAR 与 `SHA256SUMS`
- `plugin.yaml` 中版本、兼容范围、主页、问题反馈、许可证信息准确
- README、运维文档、Smoke Test 文档和当前实现一致
- PR 中已填写 Halo 官网用户名
- PR 中已勾选“上架到 Halo 应用市场”

## 参考链接

- Halo 官方文档：`https://docs.halo.run/developer-guide/appendix/publish-app/`
- Halo 应用市场：`https://www.halo.run/store/apps`
- awesome-halo 仓库：`https://github.com/halo-sigs/awesome-halo`
- awesome-halo PR 模板：`https://raw.githubusercontent.com/halo-sigs/awesome-halo/main/.github/pull_request_template.md`
