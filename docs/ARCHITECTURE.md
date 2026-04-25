# 架构设计

## 仓库角色

这个仓库是 Halo 私密正文的适配层。

它负责把 Halo 原生 `Post`、浏览器端本地加密解密、主题接入和扩展资源存储连起来，而不是再做一套独立文章系统。

## 主要分层

### 服务端集成层

负责：

- Halo 插件注册
- `PrivatePost` / `AuthorKey` 扩展资源定义
- `spec.slug` / `spec.postName` / `spec.ownerName` / `spec.fingerprint` 索引
- 文章设置 `AnnotationSetting`
- `Post` 注解到 `PrivatePost` 的同步
- 原文章页正文接管
- 独立阅读页和匿名 bundle JSON
- Finder 与 `PrivatePostView` 组装

### Console 与 Reader 前端层

负责：

- Halo Console 管理页
- Halo 文章列表中的状态字段
- Halo 原生文章编辑页中的私密正文工具
- 后台覆盖访问口令
- 锁定态 UI、解锁动作流和 Markdown 渲染
- 默认作者钥匙自动初始化
- 页面隐藏、离开和空闲超时重锁

### 浏览器密码学层

负责：

- `EncryptedPrivatePostBundle v2` 校验与归一化
- `CEK` 生成
- 正文 `AES-GCM` 加密 / 解密
- `password_slot` 的 `scrypt + AES-GCM` 包裹与解包
- `author_slots[]` 的 `RSA-OAEP` 包裹与解包
- 隐藏作者钥匙恢复 `CEK`

## 核心资源

### `Post` 注解

文章加锁后的密文 bundle 会写入：

- `metadata.annotations["privateposts.halo.run/bundle"]`

这是真正的作者编辑入口写回位置。

### `PrivatePost`

`PrivatePost` 是文章私密正文的服务端镜像，用于：

- 按 `slug` 匿名查询
- 给主题和 reader 提供统一读取入口
- 冗余公开元数据，减少匿名阅读路径对原 `Post` 的依赖

### `AuthorKey`

`AuthorKey` 只保存作者公钥元数据：

- `ownerName`
- `displayName`
- `fingerprint`
- `algorithm`
- `publicKey`
- `createdAt`

作者私钥不进入服务端资源模型。

### 浏览器本地私钥存储

作者私钥保存在浏览器 `localStorage`。

这部分是阅读端作者钥匙解锁的前提，也是“服务端不保存私钥”的实现方式。

## Bundle 结构

当前 bundle 为 `v2` 信封加密结构：

- 正文密文主体
  - `ciphertext`
  - `data_iv`
  - `auth_tag`
- 读者密码槽
  - `password_slot`
- 作者钥匙槽
  - `author_slots[]`
- 元数据
  - `metadata`

关键点：

- 正文只加密一次
- `password_slot` 和 `author_slots[]` 包裹的是同一个 `CEK`
- 密码解锁和作者钥匙解锁最终都回到同一个正文解密流程

## 关键流程

### 作者钥匙生成流

1. 作者进入文章设置或相关页面时，前端检查当前账号是否已有作者钥匙
2. 若还没有，则浏览器自动生成默认 `RSA-OAEP` 密钥对
3. 公钥写入 `AuthorKey`
4. 私钥保存在本地浏览器

### 文章加锁流

1. 作者在文章设置中输入访问密码
2. 插件读取当前文章已保存的 Markdown 正文
3. 浏览器生成随机 `CEK`
4. 用 `CEK` 加密正文
5. 用密码生成 `password_slot`
6. 用当前账号默认作者公钥生成 `author_slots[]`
7. bundle 写回文章注解
8. 文章保存事件触发同步，生成或更新 `PrivatePost`

### 密码阅读流

1. 主题渲染原文章页
2. `ReactivePostContentHandler` 按 `postName` 查找 `PrivatePost`
3. 若存在私密正文，则正文区域替换为锁定态
4. reader 请求 `/private-posts/data?slug=...`
5. 浏览器用密码解开 `password_slot`
6. 取回 `CEK` 后解正文
7. 渲染 Markdown，并在空闲/离开/切后台后重锁

### 作者钥匙恢复流

当前版本不在阅读 UI 暴露“作者钥匙直接解锁”入口。

作者钥匙链路主要用于后台覆盖访问口令：

1. 后台页读取已加密文章对应的 bundle
2. 从当前浏览器本地读取隐藏作者私钥
3. 按 `author_slots[]` 里的 `key_id` 匹配本地私钥
4. 用作者私钥解开某个 `wrapped_cek`
5. 取回 `CEK`
6. 仅重写 `password_slot`，不改正文密文和 `author_slots[]`

### 后台口令覆盖流

1. 作者在 `/console/private-posts` 选中一篇已加密文章
2. 前端从当前浏览器本地读取隐藏作者私钥
3. 用作者私钥解开某个 `author_slot`，取回 `CEK`
4. 用新的访问口令重新生成 `password_slot`
5. 仅覆盖文章注解里的 bundle，不改动正文密文和 `author_slots[]`
6. 文章保存事件再次同步 `PrivatePost`

### 删除插件清理流

1. Halo 删除插件资源
2. 插件进入 `stop()`
3. 插件读取自身 `Plugin.deletionTimestamp`
4. 若不是删除态，则只做正常停机
5. 若是删除态，则最佳努力清除所有文章上的 `privateposts.halo.run/bundle`
6. 同时删除 `PrivatePost` 与 `AuthorKey`
7. 插件继续停止并卸载

## 当前主入口与独立入口

当前主入口是：

- 原文章页内联锁定态
- 文章设置里的私密正文工具

仍保留的独立入口是：

- 独立 `/private-posts?slug=...` 阅读页

它是独立阅读入口，但主要阅读体验仍然优先收口到原文章页。

当前阅读端公开交互只保留密码输入，不暴露作者钥匙入口。

## 边界

这个仓库不做：

- 第二套正文编辑系统
- 服务端密码保存
- 服务端私钥托管
- 团队级复杂密钥治理

这个仓库负责：

- Halo 原生文章流接入
- 浏览器端本地加密解密
- 默认作者恢复钥匙兜底
- 主题接入与阅读体验
