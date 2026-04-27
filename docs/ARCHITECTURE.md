# 架构设计

## 仓库角色

这个仓库是 Halo 私密正文的适配层。

它负责把 Halo 原生 `Post`、浏览器端本地加密解密、主题接入和扩展资源存储连起来，而不是再做一套独立文章系统。

## 主要分层

### 服务端集成层

负责：

- Halo 插件注册
- `PrivatePost` 扩展资源定义
- `spec.slug` / `spec.postName` 索引
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
- 恢复助记词初始化与导入
- 后台修改或重置访问口令
- 锁定态 UI、解锁动作流，以及 Markdown/HTML 渲染与净化
- 页面隐藏、离开和空闲超时重锁

### 浏览器密码学层

负责：

- `EncryptedPrivatePostBundle v2` 校验与归一化
- `CEK` 生成
- 正文 `AES-GCM` 加密 / 解密
- `password_slot` 的 `scrypt + AES-GCM` 包裹与解包
- `recovery_slot` 的 `AES-GCM` 包裹与解包
- `mnemonic -> entropy -> HKDF-SHA-256` 恢复密钥派生
- 恢复助记词恢复 `CEK`

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

当前还约定：

- `metadata.name = spec.postName`
- `Post.metadata.annotations["privateposts.halo.run/bundle"]` 才是正文 bundle 真源
- 软删除中的 `PrivatePost` 只作为待清理残留存在，不参与正常读取与列表状态

### 浏览器本地恢复状态

恢复助记词确认或导入后，会把恢复熵状态保存在浏览器 `localStorage`。

这部分是新文章生成 `recovery_slot`、以及忘记旧口令时恢复 `CEK` 的前提，也是“服务端不保存恢复秘密”的实现方式。

## Bundle 结构

当前 bundle 为 `v2` 信封加密结构：

- 正文密文主体
  - `ciphertext`
  - `data_iv`
  - `auth_tag`
- 读者密码槽
  - `password_slot`
- 恢复槽
  - `recovery_slot`
- 元数据
  - `metadata`

关键点：

- 正文只加密一次
- `password_slot` 和 `recovery_slot` 包裹的是同一个 `CEK`
- 密码解锁和恢复助记词解锁最终都回到同一个正文解密流程

## 关键流程

### 恢复助记词初始化流

1. 作者进入 `/console/private-posts`
2. 浏览器生成随机恢复熵
3. 前端按固定词表和校验规则编码为英文助记词
4. 用户离线保存并完成确认
5. 浏览器把恢复熵状态保存到本地 `localStorage`

### 文章加锁流

1. 作者在文章设置中输入访问密码
2. 插件读取当前文章已保存的 Markdown 或 HTML 正文
3. 浏览器生成随机 `CEK`
4. 用 `CEK` 加密正文
5. 用密码生成 `password_slot`
6. 用当前浏览器里的恢复状态派生恢复密钥并生成 `recovery_slot`
7. bundle 先立即写回文章注解
8. 前端再按 `postName` upsert `PrivatePost`
9. 若镜像写入失败，则回滚文章注解，避免前端状态和实际状态分叉
10. 文章后续保存事件和插件启动补扫会继续做镜像对账

### 密码阅读流

1. 主题渲染原文章页
2. `InlinePrivatePostContentHandler` 通过 `ReactivePostContentHandler` 链路按 `postName` 查找 `PrivatePost`
3. 若存在私密正文，则正文区域替换为锁定态
4. reader 以 `no-store` 方式请求 `/private-posts/data?slug=...`
5. 浏览器用密码解开 `password_slot`
6. 取回 `CEK` 后解正文
7. 渲染 Markdown 或经过白名单净化后的 HTML，并在空闲/离开/切后台后重锁

### 取消加锁与镜像清理流

1. 作者在文章设置中点击取消加锁
2. 前端先移除文章注解 `privateposts.halo.run/bundle`
3. 前端再按 `postName` 查找并最佳努力删除所有对应 `PrivatePost`
4. 如果删除返回 `404`，按“已清理”处理，不再透传英文原始错误
5. 若仍有软删除残留，后续文章事件和插件启动补扫会继续完成清理

### 启动补扫与再次加锁流

1. 插件启动先清理失效镜像，再按现存源文章补重建缺失镜像
2. 前端再次加锁前，会先过滤并清理同 `postName` 下带 `deletionTimestamp` 的软删除残留
3. 创建或更新镜像时如遇 `404/409` 竞争写入错误，会自动重试一次

### 已知旧口令修改流

1. 后台页读取已加密文章对应的 bundle
2. 用户输入当前访问口令
3. 前端用当前访问口令解开 `password_slot`
4. 取回 `CEK`
5. 用新的访问口令重新生成 `password_slot`
6. 仅重写 `password_slot`，不改正文密文和 `recovery_slot`

### 恢复助记词重置流

1. 后台页读取已加密文章对应的 bundle
2. 用户输入恢复助记词
3. 前端用固定规则派生恢复密钥
4. 用恢复密钥解开 `recovery_slot`
5. 取回 `CEK`
6. 用新的访问口令重新生成 `password_slot`
7. 仅覆盖文章注解里的 bundle，不改动正文密文和 `recovery_slot`
8. 文章保存事件再次同步 `PrivatePost`

### 删除插件清理流

1. Halo 删除插件资源
2. 插件进入 `stop()`
3. 插件读取自身 `Plugin.deletionTimestamp`
4. 若不是删除态，则只做正常停机
5. 若是删除态，则最佳努力清除所有文章上的 `privateposts.halo.run/bundle`
6. 同时删除 `PrivatePost`
7. 插件继续停止并卸载

## 当前主入口与独立入口

当前主入口是：

- 原文章页内联锁定态
- 文章设置里的私密正文工具

仍保留的独立入口是：

- 独立 `/private-posts?slug=...` 阅读页

它是独立阅读入口，但主要阅读体验仍然优先收口到原文章页。

当前阅读端公开交互只保留密码输入，不暴露恢复助记词入口。

## 边界

这个仓库不做：

- 第二套正文编辑系统
- 服务端密码保存
- 服务端恢复秘密托管
- 团队级复杂密钥治理

这个仓库负责：

- Halo 原生文章流接入
- 浏览器端本地加密解密
- 恢复助记词兜底
- 主题接入与阅读体验
