# Halo Private Posts

`Halo Private Posts` 是一个 Halo 插件，用来把“私密正文”做成 Halo 原生文章的一种增强能力。

文章仍然是普通 `Post`，标题、slug、摘要等元数据继续公开；正文则以加密 bundle 的形式保存，并在读者浏览器内本地解密。

当前实现基于 `EncryptedPrivatePostBundle v2` 信封加密：

- 随机生成内容密钥 `CEK`
- 用 `CEK` 通过 `AES-256-GCM` 加密正文
- 用 `password_slot` 通过 `scrypt + AES-GCM` 包裹同一个 `CEK`
- 用 `author_slots[]` 通过作者公钥包裹同一个 `CEK`
- Halo 不保存访问密码，也不保存作者私钥

## 当前版本定位

当前仓库版本更接近：

- 自用 beta / RC
- 已跑通主链路
- 还没有按“公开发布到应用市场”的标准完成整体验收

特别是删除插件、主题适配和真实 Halo 环境回归，仍然按谨慎口径处理。

## 当前形态

插件现在的主工作流已经不是“单独维护一篇私密文章”，而是直接增强 Halo 原生文章流：

- 作者在文章设置里的“私密正文”工具中直接加锁或取消加锁
- 插件读取当前文章已保存的 Markdown 正文，在浏览器本地加密后写回文章注解
- 插件监听文章保存事件，把注解同步为 `PrivatePost` 扩展资源
- 系统会为每个账号自动兜底初始化一把默认作者钥匙，并在后续加锁时只写入这一把钥匙
- 原文章页正文区域会被替换成锁定态，读者可以在原页面内直接解锁
- `/private-posts?slug=...` 仍保留为独立阅读页
- `/console/private-posts` 现在只负责对已加密文章重设/覆盖访问口令

## 已实现能力

### 文章流集成

- `AnnotationSetting` 形式的文章设置工具
- 文章列表中的“是否已配置私密正文”状态字段
- 文章注解 `privateposts.halo.run/bundle` 到 `PrivatePost` 的自动同步
- 原文章页正文区域的锁定态接管与原位解锁

### 加密与解密

- `EncryptedPrivatePostBundle v2` 解析、校验和渲染
- 浏览器本地密码解锁
- 浏览器本地作者钥匙恢复 `CEK`，用于后台覆盖访问口令
- 后台基于隐藏作者私钥重设 `password_slot`
- 页面隐藏、离开和空闲超时后的自动重锁

### 作者钥匙

- `AuthorKey` 扩展资源
- 在浏览器内自动初始化 `RSA-OAEP / SHA-256` 默认作者密钥对
- 服务端仅保存公钥、指纹和作者信息
- 私钥仅保存在当前浏览器 `localStorage`
- 当前产品形态按“每个账号默认一把作者钥匙”运行，不再暴露独立管理 UI
- 加锁时自动为当前账号当前默认公钥写入 `author_slots[]`
- 后台不显示作者钥匙，也不回显旧访问口令

### 前台与接口

- `GET /private-posts?slug=...` 独立阅读页
- `GET /private-posts/data?slug=...` 匿名 bundle 数据接口
- `GET /apis/api.privateposts.halo.run/v1alpha1/private-posts` 公开查询接口
- 默认锁定页模板 `private-post.html`
- reader 静态资源通过插件 ReverseProxy 暴露到 `/plugins/halo-private-posts/assets/reader/*`

## 核心数据模型

### `PrivatePost`

`PrivatePost.spec` 当前包含：

- `postName`
- `slug`
- `title`
- `excerpt`
- `publishedAt`
- `bundle`

它是文章私密正文的服务端镜像，不是第二套正文编辑系统。

### `AuthorKey`

`AuthorKey.spec` 当前包含：

- `ownerName`
- `displayName`
- `fingerprint`
- `algorithm`
- `publicKey`
- `createdAt`

服务端只保存公钥，不保存私钥。

### 浏览器本地作者私钥

作者私钥保存在浏览器本地：

- 存储位置：`localStorage`
- 用途：作者本人在后台覆盖访问口令，以及作为隐藏恢复能力包裹同一个 `CEK`
- 约束：当前产品不在界面中暴露独立管理入口

## 卸载行为

删除插件时，当前版本会在插件 `stop()` 阶段检测插件资源是否进入删除态：

- 若只是停用、重启或升级，不执行清理
- 若是删除插件，最佳努力清除文章上的 `privateposts.halo.run/bundle` 注解
- 同时删除 `PrivatePost` 和 `AuthorKey` 扩展资源

这里的语义是“让文章恢复为普通文章”，而不是把正文重新写回另一份存储。

## 仓库结构

- [src/main/java/run/halo/privateposts](src/main/java/run/halo/privateposts)：插件主类、模型、同步、阅读页路由、Finder、主题处理器
- [src/main/resources/plugin.yaml](src/main/resources/plugin.yaml)：插件清单
- [src/main/resources/templates/private-post.html](src/main/resources/templates/private-post.html)：独立阅读页模板
- [src/main/resources/extensions/post-annotation-setting.yaml](src/main/resources/extensions/post-annotation-setting.yaml)：文章设置里的私密正文工具
- [src/main/resources/extensions/reverse-proxy-reader.yaml](src/main/resources/extensions/reverse-proxy-reader.yaml)：reader 资源代理
- [ui](ui)：Halo Console UI、文章设置工具、reader 前端代码
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：当前实现的分层、数据流和边界
- [docs/ROADMAP.md](docs/ROADMAP.md)：阶段性进度和后续计划
- [docs/ZKVAULT_INTEGRATION.md](docs/ZKVAULT_INTEGRATION.md)：协议版本与边界说明

## 开发要求

- JDK 21
- Node.js 18+
- npm 10+

Gradle 会自动构建 `ui/`，并把产物复制到插件资源目录。

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

- UI 类型检查：`cd ui && npm run type-check`
- UI 单测：`cd ui && npm run test:unit`
- 插件完整构建：`./gradlew build`
- Halo 联调：`./gradlew createHaloContainer` 后再执行 `./gradlew reloadPlugin`

## 主题接入

插件的主路径是自动接管已配置私密正文的原文章页正文区域。

如果主题还想显式补一个入口，可以继续链接到独立阅读页：

```html
<a th:href="@{/private-posts(slug=${privatePost.slug})}">阅读私密正文</a>
```

也可以通过 Finder 主动判断当前文章是否存在私密正文：

```html
<th:block th:with="privatePost=${haloPrivatePostFinder.getByPostName(post.metadata.name).block()}">
  <th:block th:if="${privatePost != null}">
    <a th:href="${privatePost.readerUrl}">阅读私密正文</a>
  </th:block>
</th:block>
```

因为 `slug` 允许包含 `/`，公开阅读页和公开 JSON 端点都使用查询参数 `slug`。

## 当前不做的事情

- DRM
- 支付或会员系统
- 登录后阅读体系
- 评论后阅读
- 私钥托管
- 复杂的多成员密钥撤销、审计和生命周期管理

## 协议说明

当前代码只支持 `EncryptedPrivatePostBundle v2`。

- 如需继续演进协议，应通过显式版本升级完成

详见 [docs/ZKVAULT_INTEGRATION.md](docs/ZKVAULT_INTEGRATION.md)。
