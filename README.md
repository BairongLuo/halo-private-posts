# Halo Private Posts

`Halo Private Posts` 是一个 Halo 插件，用来把“私密正文”做成 Halo 原生文章的一种增强能力。

文章仍然是普通 `Post`，标题、slug、摘要等元数据继续公开；正文则以加密 bundle 的形式保存，并在读者浏览器内本地解密。

当前实现只支持 `EncryptedPrivatePostBundle v3`：

- 随机生成内容密钥 `CEK`
- 用 `CEK` 通过 `AES-256-GCM` 加密正文
- 用 `password_slot` 通过 `scrypt + AES-GCM` 包裹同一个 `CEK`
- 用 `site_recovery_slot` 通过站点恢复公钥包裹同一个 `CEK`
- Halo 服务端不保存访问口令，但会保存站点恢复私钥
- 阅读端公开交互始终只保留访问口令，不暴露恢复入口

## 当前形态

插件现在的主工作流已经不是“单独维护一篇私密文章”，而是直接增强 Halo 原生文章流：

- 作者在文章编辑页顶部与 `Settings` 同级的“文章加密”入口中直接加锁或取消加锁；点击后会打开独立面板，不再进入 `Settings` 子级
- 插件读取当前文章已保存的 Markdown 或 HTML 正文，在浏览器本地加密后写回文章注解
- 加锁时前端会先立即写入文章注解，再同步 upsert `PrivatePost` 镜像；镜像写入失败会回滚注解
- 文章保存、发布、取消发布、可见性变化、删除事件，以及插件启动补扫，都会继续同步或清理 `PrivatePost` 镜像
- `PrivatePost` 资源名统一使用 `postName`；再次加锁前会先清理软删除残留，避免设置成功但列表和实际未生效
- 原文章页正文区域会被替换成锁定态，读者可以在原页面内直接解锁
- `/private-posts?slug=...` 仍保留为独立阅读页
- `/console/private-posts` 只作为隐藏的后台恢复兜底页保留；它不再出现在菜单里，主入口回到文章编辑页

## 已实现能力

### 文章流集成

- 基于 `AnnotationSetting` 维护内部注解字段，以及编辑页顶部与 `Settings` 同级、可直接打开独立面板的“文章加密”入口
- 文章列表中的“已加锁 / 未加锁”状态字段
- 文章注解 `privateposts.halo.run/bundle` 到 `PrivatePost` 的立即同步与事件补同步
- 再次加锁前的软删除镜像清理，以及 `404/409` 写入重试
- 已删除 / 已回收 / 已取消私密正文文章的镜像自动清理
- 取消私密正文后按 `postName` 补删所有镜像，`404` 不再向用户界面冒泡
- 原文章页正文区域的锁定态接管与原位解锁

### 加密与解密

- `EncryptedPrivatePostBundle v3` 生成、解析、校验和渲染
- Markdown 与 HTML 正文 payload 支持
- 浏览器本地密码解锁
- 后台通过平台恢复能力重写 `password_slot`
- 页面隐藏、离开和空闲超时后的自动重锁

### 平台恢复

- 服务端自动生成并持久化站点恢复 RSA 密钥对
- 前端加锁时只获取恢复公钥，不接触恢复私钥
- 新文章加锁时自动写入 `site_recovery_slot`
- 后台重置口令由服务端解开 `site_recovery_slot` 并重写 `password_slot`
- 重置口令时会同时回写文章真实注解和 `PrivatePost` 镜像，避免状态分叉
- 如果文章注解里的 bundle 只是占位数据、历史脏数据或结构不合法，后台不会再尝试恢复，而会直接要求重新加锁写入有效 bundle

### 前台与接口

- `GET /private-posts?slug=...` 独立阅读页
- `GET /private-posts/data?slug=...` 匿名 bundle 数据接口
- `GET /apis/api.console.halo.run/v1alpha1/private-posts/site-recovery-key`
- `POST /apis/api.console.halo.run/v1alpha1/private-posts/reset-password`
- 匿名阅读入口都返回 `Cache-Control: no-store`，避免旧 bundle 被缓存
- 默认锁定页模板 `private-post.html`

## 核心模型

### `PrivatePost`

`PrivatePost.spec` 当前包含：

- `postName`
- `slug`
- `title`
- `excerpt`
- `publishedAt`
- `bundle`

它是文章私密正文的服务端镜像，不是第二套正文编辑系统。

当前还约定：

- `PrivatePost.metadata.name = postName`
- `Post.metadata.annotations["privateposts.halo.run/bundle"]` 才是 bundle 真源
- 软删除残留会在再次加锁、取消加锁和插件启动补扫时继续清理
- 只有通过完整 `v3` 校验的 bundle 才会被视为“已加锁文章”；占位 bundle 和脏数据会被当成无效状态

### 恢复边界

当前恢复模型就是“平台托管恢复”：

- 服务端保存站点恢复私钥
- 前端只使用站点恢复公钥写入 `site_recovery_slot`
- 正常阅读仍然只能靠访问口令
- 后台重置口令时不回显正文，也不把 `CEK` 暴露给浏览器

## 文档导航

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：当前实现的分层、数据流和边界
- [docs/ROADMAP.md](docs/ROADMAP.md)：阶段性进度和后续计划
- [docs/RECOVERY_MODES.md](docs/RECOVERY_MODES.md)：当前恢复模型
- [docs/MAINTENANCE.md](docs/MAINTENANCE.md)：维护说明，记录当前实现约束和主要入口
- [docs/OPERATIONS.md](docs/OPERATIONS.md)：站点管理员视角的安装、升级、卸载与回滚说明
- [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md)：发布前 smoke test 清单

## 开发要求

- JDK 21
- Node.js 20+（仅在手动执行 `ui/` 下命令时需要）
- npm 10+

Gradle 会自动下载并使用 `Node.js 20.19.0` 构建 `ui/`，然后把产物复制到插件资源目录。

## 本地开发

完整构建：

```bash
./gradlew build
```

启动 Halo 开发容器并首次初始化：

```bash
./gradlew createHaloContainer
```

实例完成初始化后，热重载插件：

```bash
./gradlew reloadPlugin
```

单独验证前端：

```bash
cd ui
npm install
npm run type-check
npm run test:unit
npm run build
```

## 验证建议

- 常规回归：`./gradlew check`
- 打包 smoke check：`./gradlew smokeCheck`
- 开发容器 smoke：`./scripts/dev-container-smoke.sh`
- 一键本地验收（含 smoke、登录态恢复、独立阅读页与卸载演练）：`./scripts/dev-container-acceptance.sh`
- 安装 Playwright 浏览器：`./gradlew installPlaywrightUi`
- 登录态恢复与独立阅读页 e2e：`./gradlew testE2eUi`
- 卸载清理 smoke：`./scripts/dev-container-uninstall-smoke.sh`
- 发版构建 workflow：`.github/workflows/release.yml`
- UI 类型检查：`cd ui && npm run type-check`
- UI 单测：`cd ui && npm run test:unit`
- 插件完整构建：`./gradlew build`

`./scripts/dev-container-acceptance.sh` 默认也会补跑一次卸载演练；如需只跑常规链路，可临时使用 `RUN_UNINSTALL_SMOKE=0 ./scripts/dev-container-acceptance.sh`。
如果要在 GitHub Actions 上手动跑完整链路，可触发 `.github/workflows/full-regression.yml`。
如果要生成正式发布资产，可手动触发 `.github/workflows/release.yml`，或直接推送 `v*` tag；它会执行 `./gradlew smokeCheck`、产出插件 JAR、生成 `SHA256SUMS`，并在 tag 场景下创建 GitHub Release。

## 站点上线

如果要部署到真实 Halo 站点，先看：

- [docs/OPERATIONS.md](docs/OPERATIONS.md)
- [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md)

## 当前不做的事情

- DRM
- 支付或会员系统
- 登录后阅读体系
- 评论后阅读
- 多成员复杂密钥撤销、审计和生命周期管理

## 协议说明

当前代码只支持 `EncryptedPrivatePostBundle v3`。

- `v3`：`password_slot + site_recovery_slot`

如需继续演进协议，应通过显式版本升级完成。
