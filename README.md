# Halo Private Posts

`Halo Private Posts` 是一个 Halo 插件，用来给 Halo 原生文章增加“正文加密、浏览器本地解密、自动重锁”的能力。

文章仍然保持普通 `Post` 工作流：标题、slug、摘要等元数据继续公开，正文则以加密 bundle 的形式保存，并在读者浏览器里本地解密。

## 效果预览

### 编辑页加密面板

<img src="docs/images/editor-panel.png" alt="编辑页加密面板" width="50%" />

### 文章列表状态

<img src="docs/images/post-list-status.png" alt="文章列表状态" width="50%" />

## 核心能力

- 直接增强 Halo 原生文章，不维护第二套正文系统
- 文章列表展示 `已加锁 / 未加锁` 状态，可直接点击跳转到编辑器并自动打开设置里的加密模块
- 编辑器设置面板里提供 `文章加密` 模块，勾选后直接走 Halo 原生保存
- 读者在原文章页或独立阅读页输入访问密码后，本地解密正文
- 页面离开、切后台或空闲超时后自动重新锁定
- 后台仅保留平台恢复口令重置页，不暴露正文和内容密钥

## 工作方式

- 加锁和重算都基于文章的最新已保存正文
- 首次加锁在浏览器本地完成加密，再把 bundle 写回文章注解
- 已加密文章再次保存时，服务端通过恢复私钥链路重算密文，不依赖前端缓存正文
- 服务端同步维护 `PrivatePost` 镜像，处理列表状态、阅读接口和恢复流程
- 原文章页正文区域会被锁定态接管，解锁后原位阅读
- `/private-posts?slug=...` 保留为独立阅读页

## 兼容与协议

- Halo：`>= 2.24.0`
- 当前只支持 `EncryptedPrivatePostBundle v3`

`v3` 使用：

- 随机生成内容密钥 `CEK`
- 用 `CEK` 通过 `AES-256-GCM` 加密正文
- 用 `password_slot` 通过 `scrypt + AES-GCM` 包裹同一个 `CEK`
- 用 `site_recovery_slot` 通过站点恢复公钥包裹同一个 `CEK`
- Halo 服务端不保存访问口令，但会保存站点恢复私钥
- 阅读端公开交互始终只保留访问口令，不暴露恢复入口

## 已实现能力

### 文章流集成

- 基于 `AnnotationSetting` 在编辑器设置面板注入“文章加密”模块，并隐藏内部 bundle 字段
- 文章列表中的“已加锁 / 未加锁”可点击状态字段，会跳转到编辑器并自动打开设置面板
- 文章注解 `privateposts.halo.run/bundle` 到 `PrivatePost` 的立即同步与事件补同步
- 主编辑器保存正文和设置面板保存元数据两条链路都会触发密文同步
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

## 快速安装

1. 从 GitHub Releases 下载插件 JAR。
2. 在 Halo 后台安装并启用插件。
3. 打开文章列表，点击 `已加锁 / 未加锁` 状态。
4. 插件会跳转到编辑器，并自动打开设置里的“文章加密”模块。
5. 先输入访问密码并勾选启用，再点击 Halo 原生保存。

更完整的上线、升级、回滚和卸载说明见 [docs/OPERATIONS.md](docs/OPERATIONS.md)。

## 文档导航

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：当前实现的分层、数据流和边界
- [docs/ROADMAP.md](docs/ROADMAP.md)：阶段性进度和后续计划
- [docs/RECOVERY_MODES.md](docs/RECOVERY_MODES.md)：当前恢复模型
- [docs/DOCUMENTATION_STANDARDS.md](docs/DOCUMENTATION_STANDARDS.md)：文档职责边界和更新规则
- [docs/QUALITY_GATES.md](docs/QUALITY_GATES.md)：改动类型与测试 / 构建门槛
- [docs/MAINTENANCE.md](docs/MAINTENANCE.md)：维护说明，记录当前实现约束和主要入口
- [docs/SAVE_ENCRYPTION_CONTRACT.md](docs/SAVE_ENCRYPTION_CONTRACT.md)：保存、加密和密文同步行为契约
- [docs/OPERATIONS.md](docs/OPERATIONS.md)：站点管理员视角的安装、升级、卸载与回滚说明
- [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md)：发布前 smoke test 清单
- [docs/HALO_APP_STORE_SUBMISSION.md](docs/HALO_APP_STORE_SUBMISSION.md)：Halo 商店上架材料与 PR 草案

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

快速校验：

```bash
./gradlew quickCheck
```

完整本地验证：

```bash
./gradlew verifyAll
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

## 站点上线

如果要部署到真实 Halo 站点，先看：

- [docs/OPERATIONS.md](docs/OPERATIONS.md)
- [docs/QUALITY_GATES.md](docs/QUALITY_GATES.md)
- [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md)
