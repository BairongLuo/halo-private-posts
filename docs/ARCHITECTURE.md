# 架构设计

## 仓库角色

这个仓库是 Halo 私密正文的适配层。

它负责把 Halo 原生 `Post`、浏览器端本地加密解密、平台恢复、主题接入和扩展资源存储连起来，而不是再做一套独立文章系统。

## 主要分层

### 服务端集成层

负责：

- Halo 插件注册
- `PrivatePost` 扩展资源定义
- `spec.slug` / `spec.postName` 索引
- 文章设置 `AnnotationSetting`
- `Post` 注解到 `PrivatePost` 的同步
- 站点恢复密钥管理
- 后台平台恢复接口
- 原文章页正文接管
- 独立阅读页和匿名 bundle JSON
- Finder 与 `PrivatePostView` 组装

### Console 与 Reader 前端层

负责：

- 隐藏后台恢复页
- Halo 文章列表中的状态字段
- Halo 文章列表三点菜单与编辑页顶部两处“文章加密”入口
- 后台平台恢复重置访问口令
- 锁定态 UI、解锁动作流，以及 Markdown/HTML 渲染与净化
- 页面隐藏、离开和空闲超时重锁

### 浏览器密码学层

负责：

- `EncryptedPrivatePostBundle v3` 校验与归一化
- `CEK` 生成
- 正文 `AES-GCM` 加密 / 解密
- `password_slot` 的 `scrypt + AES-GCM` 包裹与解包
- `site_recovery_slot` 的公钥包裹

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
- 只有通过当前 `v3` 校验的 bundle 才会进入同步、公开读取和平台恢复链路

### 站点恢复密钥

当前平台恢复模型新增了一组服务端密钥：

- 服务端保存站点恢复 RSA 私钥
- 前端只获取站点恢复公钥
- 新文章加锁时写入 `site_recovery_slot`
- 后台重置口令时由服务端解开 `site_recovery_slot`

## Bundle 结构

当前 bundle 为 `v3`：

- 正文密文主体
  - `ciphertext`
  - `data_iv`
  - `auth_tag`
- 读者密码槽
  - `password_slot`
- 平台恢复槽
  - `site_recovery_slot`
- 元数据
  - `metadata`

关键点：

- 正文只加密一次
- `password_slot` 和 `site_recovery_slot` 包裹的是同一个 `CEK`
- 正常阅读始终走密码解锁
- 平台恢复只用于后台重置口令

## 关键流程

### 文章加锁流

1. 作者从文章列表三点菜单或文章编辑页顶部进入“文章加密”面板并输入访问密码
2. 插件读取当前文章已保存的 Markdown 或 HTML 正文
3. 浏览器生成随机 `CEK`
4. 用 `CEK` 加密正文
5. 用密码生成 `password_slot`
6. 从后台获取站点恢复公钥并生成 `site_recovery_slot`
7. bundle 先立即写回文章注解
8. 前端再按 `postName` upsert `PrivatePost`
9. 若镜像写入失败，则回滚文章注解，避免前端状态和实际状态分叉
10. 文章后续保存事件和插件启动补扫会继续做镜像对账

### 密码阅读流

1. 主题渲染原文章页
2. `InlinePrivatePostContentHandler` 按 `postName` 查找 `PrivatePost`
3. 若存在私密正文，则正文区域替换为锁定态
4. reader 以 `no-store` 方式请求 `/private-posts/data?slug=...`
5. 浏览器用密码解开 `password_slot`
6. 取回 `CEK` 后解正文
7. 渲染 Markdown 或经过白名单净化后的 HTML，并在空闲/离开/切后台后重锁

### 平台恢复重置流

1. 后台页读取已加密文章对应的 bundle
2. 用户输入新的访问口令
3. 服务端使用站点恢复私钥解开 `site_recovery_slot`
4. 取回 `CEK`
5. 服务端重新生成 `password_slot`
6. 服务端同时回写文章注解里的 bundle 和 `PrivatePost`
7. 正文密文和 `site_recovery_slot` 保持不变

如果第 1 步读到的源文章 bundle 没通过当前 `v3` 校验，流程会在进入解包前直接终止，并明确要求重新加锁；不会再拿无效占位数据去尝试恢复。
当前同步和公开读取仍通过 `PrivatePostBundleValidator` 过滤，后台恢复路由则在本地执行等价校验，避免 Halo 开发容器热重载时出现共享 validator 类加载失败。

### 取消加锁与镜像清理流

1. 作者在“文章加密”面板中点击取消加锁
2. 前端先移除文章注解 `privateposts.halo.run/bundle`
3. 前端再按 `postName` 查找并最佳努力删除所有对应 `PrivatePost`
4. 如果删除返回 `404`，按“已清理”处理，不再透传英文原始错误
5. 若仍有软删除残留，后续文章事件和插件启动补扫会继续完成清理

## 当前主入口与独立入口

当前主入口是：

- 原文章页内联锁定态
- 文章列表三点菜单与编辑页顶部两处“文章加密”入口

仍保留的独立入口是：

- 独立 `/private-posts?slug=...` 阅读页

当前阅读端公开交互只保留密码输入，不暴露恢复入口。

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
