# 架构

## 仓库角色

本插件是在 Halo 原生文章上增加私密正文能力。文章仍然是 `Post`；插件只负责加密正文、同步镜像、接管阅读展示和提供后台恢复。

## 主要分层

### 服务端集成层

负责：

- Halo 插件注册
- `PrivatePost` 扩展资源定义
- `spec.slug` / `spec.postName` 索引
- 文章设置 `AnnotationSetting`
- `Post` 注解到 `PrivatePost` 的同步
- 站点恢复密钥管理
- Console 平台恢复接口
- 原文章页正文接管
- 独立阅读页和匿名 bundle JSON
- Finder 与 `PrivatePostView` 组装

### Console 与 Reader 前端层

负责：

- 后台平台恢复页
- 文章列表加锁状态字段
- 文章列表状态标签、操作菜单，以及文章设置中的“文章加密”模块
- 后台平台恢复重置访问口令
- 前台锁定态、解锁流程、Markdown/HTML 渲染与净化
- 页面隐藏、离开和空闲超时后的重锁

### 浏览器密码学层

负责：

- `EncryptedPrivatePostBundle v3` 校验与归一化
- `CEK` 生成
- 正文 `AES-GCM` 加密 / 解密
- `password_slot` 的 `scrypt + AES-GCM` 包裹与解包
- `site_recovery_slot` 的公钥包裹

## 核心资源

### `Post`

文章加锁后的密文 bundle 会写入：

- `metadata.annotations["privateposts.halo.run/bundle"]`

这是正文密文的真源。任何保存、刷新、重置密码或取消加锁，都必须以这个注解为准。

### `PrivatePost`

`PrivatePost` 是服务端镜像，用于：

- 按 `slug` 匿名查询
- 给主题和 reader 提供统一读取入口
- 冗余公开元数据，减少匿名阅读路径对 `Post` 的依赖

约束：

- `metadata.name = spec.postName`
- `Post.metadata.annotations["privateposts.halo.run/bundle"]` 才是正文 bundle 真源
- 软删除中的 `PrivatePost` 只作为待清理残留存在，不参与正常读取与列表状态
- 只有通过当前 `v3` 校验的 bundle 才会进入同步、公开读取和平台恢复链路

### 站点恢复密钥

- 服务端保存站点恢复 RSA 私钥
- 前端只获取站点恢复公钥
- 新文章加锁时写入 `site_recovery_slot`
- 后台重置口令时由服务端解开 `site_recovery_slot`

## Bundle v3

核心字段：

- 正文密文：`ciphertext`、`data_iv`、`auth_tag`
- 读者密码槽：`password_slot`
- 平台恢复槽：`site_recovery_slot`
- 公开元数据：`metadata`

约束：

- 正文只加密一次。
- `password_slot` 和 `site_recovery_slot` 包裹的是同一个 `CEK`
- 正常阅读只走密码解锁。
- 平台恢复只用于后台重置口令。
- `metadata.description` 是插件锁定说明。它不等同于 Halo 原生摘要;锁定态前台用它占用原摘要展示位置，原生摘要字段仍由 Halo 自己维护。

## 关键流程

### 文章加锁流

1. 作者进入文章设置：可以从编辑页进入，也可以从 `/console/posts` 的原生设置抽屉进入。
2. 前端渲染“文章加密”模块。编辑页优先使用 `AnnotationSetting` slot；列表设置抽屉在隐藏 bundle 字段附近补一个 fallback slot。
3. 作者输入访问密码、勾选启用，并点击 Halo 原生保存。
4. 首次加锁时，浏览器读取文章的**已发布(released)正文**，生成随机 `CEK`;文章从未发布则提示先发布。
5. 浏览器用 `CEK` 加密正文，用访问密码生成 `password_slot`，用恢复公钥生成 `site_recovery_slot`。
6. bundle 写回 `Post` 注解，再按 `postName` upsert `PrivatePost`。
7. 已加密文章仅保存草稿时不重算密文(公开页继续显示已发布版本);改公开 metadata、锁定说明或密码时由服务端按已发布快照重算密文;发布时用即将发布的快照重算。
8. 后续文章事件和插件启动补扫继续做镜像对账。

### 密码阅读流

1. 主题渲染原文章页
2. `InlinePrivatePostContentHandler` 按 `postName` 查找 `PrivatePost`
3. 若存在私密正文，则正文区域替换为锁定态
4. reader 以 `no-store` 方式请求 `/private-posts/data?slug=...`
5. 浏览器用密码解开 `password_slot`
6. 取回 `CEK` 后解正文
7. 渲染 Markdown 或经过白名单净化后的 HTML，并在空闲/离开/切后台后重锁

### 平台恢复重置流

1. 后台恢复页读取已加密文章对应的 bundle
2. 用户输入新的访问密码
3. 服务端使用站点恢复私钥解开 `site_recovery_slot`
4. 取回 `CEK`
5. 服务端重新生成 `password_slot`
6. 服务端同时回写文章注解里的 bundle 和 `PrivatePost`
7. 正文密文和 `site_recovery_slot` 保持不变

如果源文章 bundle 没通过当前 `v3` 校验，流程会在解包前终止，并提示重新加锁。同步和公开读取使用 `PrivatePostBundleValidator` 过滤；后台恢复路由保留等价的本地校验，避免 Halo 开发容器热重载时共享 validator 类加载失败。

### 取消加锁与镜像清理流

1. 作者在“文章加密”面板中点击取消加锁
2. 前端先移除文章注解 `privateposts.halo.run/bundle`
3. 前端再按 `postName` 查找并最佳努力删除所有对应 `PrivatePost`
4. 如果删除返回 `404`，按“已清理”处理，不再透传英文原始错误
5. 若仍有软删除残留，后续文章事件和插件启动补扫会继续完成清理

## 当前主入口与独立入口

主入口：

- 原文章页内联锁定态
- 文章列表状态标签和操作菜单
- 编辑器设置面板和文章列表原生设置抽屉中的“文章加密”模块

独立入口：

- 独立 `/private-posts?slug=...` 阅读页

阅读端公开交互只保留密码输入，不暴露恢复入口。

## 边界

这个仓库不做：

- 第二套正文编辑系统
- 服务端密码保存
- 把恢复私钥下发给浏览器
- 团队级复杂密钥治理

这个仓库负责：

- Halo 原生文章流接入
- 浏览器端本地加密解密
- 平台恢复兜底
- 主题接入与阅读体验
