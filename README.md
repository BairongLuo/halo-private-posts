# Halo Private Posts

`Halo Private Posts` 是一个 Halo 插件，用来把“私密正文”做成 Halo 原生文章的一种增强能力。

文章仍然是普通 `Post`，标题、slug、摘要等元数据继续公开；正文则以加密 bundle 的形式保存，并在读者浏览器内本地解密。

当前实现基于 `EncryptedPrivatePostBundle v2` 信封加密：

- 随机生成内容密钥 `CEK`
- 用 `CEK` 通过 `AES-256-GCM` 加密正文
- 用 `password_slot` 通过 `scrypt + AES-GCM` 包裹同一个 `CEK`
- 用 `recovery_slot` 通过恢复助记词派生出的恢复密钥包裹同一个 `CEK`
- Halo 不保存访问密码，也不保存恢复助记词

## 当前形态

插件现在的主工作流已经不是“单独维护一篇私密文章”，而是直接增强 Halo 原生文章流：

- 作者在文章设置里的“私密正文”工具中直接加锁或取消加锁
- 插件读取当前文章已保存的 Markdown 或 HTML 正文，在浏览器本地加密后写回文章注解
- 加锁时前端会先立即写入文章注解，再同步 upsert `PrivatePost` 镜像；镜像写入失败会回滚注解
- 文章保存、发布、取消发布、可见性变化、删除事件，以及插件启动补扫，都会继续同步或清理 `PrivatePost` 镜像
- `PrivatePost` 资源名统一使用 `postName`；再次加锁前会先清理软删除残留，避免设置成功但列表和实际未生效
- 原文章页正文区域会被替换成锁定态，读者可以在原页面内直接解锁
- `/private-posts?slug=...` 仍保留为独立阅读页
- `/console/private-posts` 负责初始化或导入恢复助记词，以及对已加密文章修改/重置访问口令

## 当前状态

当前版本更接近：

- 自用 beta / RC
- 主链路已经跑通
- 还没有按“公开发布到应用市场”的标准完成整体验收

当前主要剩余工作已经收敛到主题适配、安装文档和更大范围的兼容性回归，不再是主链路阻塞。

## 已实现能力

### 文章流集成

- `AnnotationSetting` 形式的文章设置工具
- 文章列表中的“是否已配置私密正文”状态字段
- 文章注解 `privateposts.halo.run/bundle` 到 `PrivatePost` 的立即同步与事件补同步
- 再次加锁前的软删除镜像清理，以及 `404/409` 写入重试
- 已删除 / 已回收 / 已取消私密正文文章的镜像自动清理
- 取消私密正文后按 `postName` 补删所有镜像，`404` 不再向用户界面冒泡
- 原文章页正文区域的锁定态接管与原位解锁

### 加密与解密

- `EncryptedPrivatePostBundle v2` 解析、校验和渲染
- Markdown 与 HTML 正文 payload 支持
- 浏览器本地密码解锁
- 浏览器本地恢复助记词恢复 `CEK`
- 后台支持两条口令维护路径
- 知道旧口令时直接重写 `password_slot`
- 忘记旧口令时通过恢复助记词重写 `password_slot`
- 页面隐藏、离开和空闲超时后的自动重锁

### 恢复助记词

- 初始化时在浏览器本地生成随机恢复熵
- 使用固定词表和校验规则编码为英文助记词
- 用 `mnemonic -> entropy -> HKDF-SHA-256(info="halo-private-posts/recovery/v1")` 派生恢复密钥
- 恢复助记词只显示一次，确认后仅把恢复状态保存在当前浏览器 `localStorage`
- 加锁时自动写入单一 `recovery_slot`
- 后台不显示恢复助记词，也不回显旧访问口令

### 前台与接口

- `GET /private-posts?slug=...` 独立阅读页
- `GET /private-posts/data?slug=...` 匿名 bundle 数据接口
- 两个匿名阅读入口都返回 `Cache-Control: no-store`，避免旧 bundle 被缓存
- 默认锁定页模板 `private-post.html`
- reader 静态资源通过插件 ReverseProxy 暴露到 `/plugins/halo-private-posts/assets/reader/*`

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

### 浏览器本地恢复状态

恢复状态保存在浏览器本地：

- 存储位置：`localStorage`
- 用途：为新文章加锁时生成 `recovery_slot`，以及在忘记旧口令时恢复 `CEK`
- 约束：服务端不保存恢复秘密，助记词不会再次显示

## 同步与清理语义

- 加锁时，前端会先把新 bundle 写入文章注解，再同步 upsert `PrivatePost`；如果镜像写入失败，会回滚注解，避免“设置里成功但实际未生效”
- 取消加锁时，前端会先移除文章注解，再按 `postName` 最佳努力删除所有 `PrivatePost` 镜像；若镜像补删暂时失败，后台事件和启动补扫会继续清理
- `PrivatePost` 查询和列表默认忽略带 `deletionTimestamp` 的软删除资源，避免历史残留影响再次加锁或后台状态显示

## 文档导航

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：当前实现的分层、数据流和边界
- [docs/ROADMAP.md](docs/ROADMAP.md)：阶段性进度和后续计划
- [docs/ZKVAULT_INTEGRATION.md](docs/ZKVAULT_INTEGRATION.md)：协议版本与边界说明
- [docs/MAINTENANCE.md](docs/MAINTENANCE.md)：维护说明，记录当前实现约束和主要入口

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

如果执行过 `./gradlew clean`，再做联调前建议先重建开发容器。当前 Halo devtools 会把本地 `build/`
做成 bind mount；`clean` 删除并重建目录后，旧容器里的挂载会指向已经失效的旧 inode。

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

## 仓库结构

- [src/main/java/run/halo/privateposts](src/main/java/run/halo/privateposts)：插件主类、模型、同步、阅读页路由、Finder、主题处理器
- [src/main/resources/plugin.yaml](src/main/resources/plugin.yaml)：插件清单
- [src/main/resources/templates/private-post.html](src/main/resources/templates/private-post.html)：独立阅读页模板
- [src/main/resources/extensions/post-annotation-setting.yaml](src/main/resources/extensions/post-annotation-setting.yaml)：文章设置里的私密正文工具
- [src/main/resources/extensions/reverse-proxy-reader.yaml](src/main/resources/extensions/reverse-proxy-reader.yaml)：reader 资源代理
- [ui](ui)：Halo Console UI、文章设置工具、reader 前端代码

## 当前不做的事情

- DRM
- 支付或会员系统
- 登录后阅读体系
- 评论后阅读
- 恢复秘密托管
- 复杂的多成员密钥撤销、审计和生命周期管理

## 协议说明

当前代码只支持 `EncryptedPrivatePostBundle v2`。

- 如需继续演进协议，应通过显式版本升级完成

详见 [docs/ZKVAULT_INTEGRATION.md](docs/ZKVAULT_INTEGRATION.md)。
