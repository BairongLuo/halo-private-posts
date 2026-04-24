# Halo Private Posts

`Halo Private Posts` 是一个 Halo 插件，负责托管私密文章的公开元数据和加密 bundle，并在读者浏览器中完成本地解密。

它不是“限制阅读”的另一层壳，而是密文正文分发适配层：

- Halo 继续负责公开元数据和主题渲染
- 插件负责保存 `EncryptedPrivatePostBundle`
- 读者输入访问密码后，浏览器本地执行 `scrypt + AES-256-GCM`
- 页面隐藏、离开或空闲超时后自动重新锁定

## 当前范围

这个仓库当前只做 Halo 适配层：

- 用 `PrivatePost` 扩展资源保存文章映射和加密 bundle
- 为 Halo 主题暴露私密文章阅读入口
- 提供 Console 管理页维护映射关系
- 在浏览器内完成 bundle 校验、解密、渲染和重锁

它不重新定义协议，而是消费 `ZKVault` 中定义的 `EncryptedPrivatePostBundle`。

## 当前推进状态

目前这条线已经从“验证独立阅读页可行”推进到“开始贴近 Halo 原生文章流”：

- 已完成
  - 文章列表状态字段
    - 在 Halo 文章列表中显示“是否已配置私密正文”
    - 可直接从文章列表跳到对应文章的私密正文配置页
  - 管理页文章绑定增强
    - 支持按 `postName` 载入现有 Halo 文章
    - 在配置页显示标题、slug、摘要、发布时间和可见性
    - 保存或删除私密正文后，同步刷新文章列表状态
  - 阅读页主题变量适配
    - reader 不再完全依赖固定配色
    - 改为支持主题通过 CSS 变量覆盖页面背景、文字、强调色和字体
- 仍未完成
  - Halo 原生文章编辑器里的私密正文配置入口
  - 作者侧“输入正文 + 密码后直接生成 bundle”的完整流
  - 在原文章详情页中原位显示锁定态和解锁后的正文

## 已实现能力

- Halo 插件工程骨架：Gradle、JDK 21、Node UI 构建、Gradle wrapper
- 自定义模型 `PrivatePost`
  - 记录 `postName`
  - 冗余公开元数据 `slug/title/excerpt/publishedAt`
  - 保存完整加密 bundle
- 自定义索引
  - `spec.slug` 唯一
  - `spec.postName` 唯一
- Halo 扩展资源 API
  - Console 管理页通过 `/apis/privateposts.halo.run/v1alpha1/privateposts` CRUD `PrivatePost`
- 查询 API
  - 额外注册了 `groupVersion = api.privateposts.halo.run/v1alpha1` 的 `CustomEndpoint`
  - 路由为 `GET /private-posts`，支持按 `slug` 查询或列出 `PrivatePostView`
- 前台阅读页
  - `GET /private-posts?slug=...`
  - `GET /private-posts/data?slug=...` 提供匿名 bundle JSON
  - 默认主题模板 `private-post.html`
  - reader 资源通过插件 ReverseProxy 暴露到 `/plugins/halo-private-posts/assets/reader/*`
- 主题 Finder
  - `haloPrivatePostFinder.getBySlug(slug)`
  - `haloPrivatePostFinder.getByPostName(postName)`
  - `haloPrivatePostFinder.listAll()`
- Console 管理页
  - 录入/更新/删除私密文章映射
  - 从文章列表按 `postName` 跳转到对应配置页
  - 载入和展示对应 Halo 文章的摘要信息
  - 本地解锁测试
  - Markdown 预览
- Halo 文章流集成
  - 通过 `post:list-item:field:create` 在文章列表增加私密正文状态字段
- 协议兼容测试
  - 使用 `ZKVault` 的 `v1` fixture 验证浏览器解密结果

## 仓库结构

- [src/main/java/run/halo/privateposts](src/main/java/run/halo/privateposts)：插件主类、模型、Finder、公共路由
- [src/main/resources/plugin.yaml](src/main/resources/plugin.yaml)：插件清单
- [src/main/resources/templates/private-post.html](src/main/resources/templates/private-post.html)：默认前台锁定页模板
- [src/main/resources/extensions/reverse-proxy-reader.yaml](src/main/resources/extensions/reverse-proxy-reader.yaml)：reader 静态资源代理
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：当前实现分层与数据流
- [docs/ROADMAP.md](docs/ROADMAP.md)：已完成项、当前阶段与下一步计划
- [docs/ZKVAULT_INTEGRATION.md](docs/ZKVAULT_INTEGRATION.md)：协议边界与 fixture 同步约束
- [ui](ui)：Halo Console 页和前台 reader 打包入口
- [fixtures/private-post/v1/reference-hello](fixtures/private-post/v1/reference-hello)：从 `ZKVault` 同步过来的兼容性样本

## 开发要求

- JDK 21
- Node.js 18+
- npm 9+

Gradle 构建会自动使用 `ui/` 的 npm 依赖，并把产物复制到插件资源目录。

## 本地开发

```bash
./gradlew build
```

启动 Halo 开发容器并首次初始化：

```bash
./gradlew createHaloContainer
```

然后访问 `http://127.0.0.1:8090/system/setup` 完成首次 setup。

默认本地开发凭据如下，`reloadPlugin` 也会使用这组账号：

- 用户名：`admin`
- 密码：`Admin12345!`
- 站点地址：`http://localhost:8090`

如果你想改成本地自己的值，可以覆盖 Gradle 属性：

```bash
./gradlew \
  -PhaloExternalUrl=http://127.0.0.1:8090 \
  -PhaloSuperAdminUsername=admin \
  -PhaloSuperAdminPassword='Admin12345!' \
  reloadPlugin
```

实例完成 setup 之后，热重载插件：

```bash
./gradlew reloadPlugin
```

只验证前端时：

```bash
cd ui
npm install
npm run test:unit
npm run build
```

## 验证建议

- UI 单测：`cd ui && npm run test:unit`
- UI 打包：`cd ui && npm run build`
- 插件完整构建：`./gradlew build`
- Halo 开发环境联调：`./gradlew createHaloContainer` 然后 `./gradlew reloadPlugin`

## 主题接入

插件提供两种接入方式：

1. 直接跳到插件阅读页：

```html
<a th:href="@{/private-posts(slug=${privatePost.slug})}">阅读私密正文</a>
```

2. 在主题里自行渲染锁定态：

```html
<th:block th:with="privatePost=${haloPrivatePostFinder.getByPostName(post.metadata.name).block()}">
  <th:block th:if="${privatePost != null}">
    <a th:href="${privatePost.readerUrl}">阅读私密正文</a>
  </th:block>
</th:block>
```

因为 `slug` 允许包含 `/`，插件公开阅读页和公开 JSON 端点都使用查询参数 `slug`，而不是 path variable。

## 当前未覆盖范围

- 直接嵌入 Halo 原生文章编辑器
- 在 Halo 内部完成作者侧加密
- 在原文章页中原位接管普通文章正文渲染
- 应用市场发布资产和 CI 流水线

下一阶段优先级见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## 与 ZKVault 的关系

这个仓库只消费 `ZKVault` 协议，不重新定义协议。

- `ZKVault`：协议、fixture、参考实现
- `halo-private-posts`：Halo 插件、主题接入、浏览器交互

详见 [docs/ZKVAULT_INTEGRATION.md](docs/ZKVAULT_INTEGRATION.md)。
