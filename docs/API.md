# API 说明

本文档只描述插件自己提供或依赖的接口边界。文章创建、草稿保存、发布和更新仍然使用 Halo 原生文章 API；插件不替换 Halo 的文章生命周期。

## Halo 原生保存链路

插件挂在 Halo 原生文章上工作，`Post` 仍是文章真源。

### 草稿保存

- 接口：`PUT /apis/api.console.halo.run/v1alpha1/posts/{name}/content`
- 请求体：Halo 原生 `Content`
- 语义：保存草稿正文，与未安装插件时一致。

加密文章仅保存草稿时，插件不重算密文。公开页仍只展示上一次已发布内容，读者解锁后不会看到未发布草稿。

### 设置保存 / 元数据更新

- 接口：`PUT /apis/content.halo.run/v1alpha1/posts/{name}`
- 请求体：Halo 原生 `Post`
- 语义：保存标题、slug、原生摘要、可见性等文章元数据，与未安装插件时一致。

插件会同步私密正文 bundle 的公开元数据，但不接管 Halo 原生摘要字段。锁定态前台不显示原生摘要，而是用 `bundle.metadata.description` 作为锁定说明，占用原摘要的展示位置。

### 发布

- 接口：`PUT /apis/api.console.halo.run/v1alpha1/posts/{name}/publish?headSnapshot={snapshotName}`
- 请求体：空
- 语义：发布指定草稿快照，与 Halo 原生发布一致。

已加密文章发布时，插件用 `headSnapshot` 指向的即将发布快照重算密文。发布完成后，读者解锁看到的就是这次发布后的正文。

## 插件 Console API

插件的 console API 挂在 `api.console.halo.run/v1alpha1` 下，面向后台已认证用户。它们不创建或发布文章，只维护加密 bundle、恢复公钥和访问口令。

### 获取平台恢复公钥

```http
GET /apis/api.console.halo.run/v1alpha1/private-posts/site-recovery-key
```

响应：

```json
{
  "kid": "site-recovery",
  "alg": "RSA-OAEP-SHA256",
  "publicKey": "base64..."
}
```

用途：前端首次加锁时用公钥写入 `site_recovery_slot`。恢复私钥只保存在服务端。

### 刷新密文

```http
POST /apis/api.console.halo.run/v1alpha1/private-posts/refresh-bundle
Content-Type: application/json
```

请求体：

```json
{
  "postName": "post-name",
  "snapshotName": "optional-head-snapshot",
  "metadata": {
    "slug": "post-slug",
    "title": "Post title",
    "excerpt": "Halo native excerpt",
    "publishedAt": "2026-06-18T00:00:00Z",
    "description": "锁定说明"
  },
  "nextPassword": "optional-new-password"
}
```

规则：

- 有 `snapshotName` 时，按指定快照重算密文，发布路径使用这一模式。
- 没有 `snapshotName` 时，按已发布正文重算密文；不会回退到草稿快照。
- 文章从未发布时返回业务错误，要求先发布文章。
- `description` 是插件锁定说明，不是 Halo 原生摘要。

成功响应包含更新后的 `bundle`。

### 平台恢复重置访问口令

```http
POST /apis/api.console.halo.run/v1alpha1/private-posts/reset-password
Content-Type: application/json
```

请求体：

```json
{
  "postName": "post-name",
  "nextPassword": "new-password"
}
```

语义：服务端用站点恢复私钥解开 `site_recovery_slot`，只重写 `password_slot`。正文密文和文章正文不变。

## 前台读取接口

### 匿名 bundle 数据

```http
GET /private-posts/data?slug={postSlug}
```

语义：返回加密正文 bundle 和必要公开元数据。响应禁止缓存。浏览器用访问密码在本地解密，服务端不接收读者密码。

### Reader 静态资源

```http
GET /plugins/halo-private-posts/assets/reader/reader.css?version={pluginVersion}
GET /plugins/halo-private-posts/assets/reader/reader.js?version={pluginVersion}
```

`version` 来自插件实现版本，用于绕开 Halo / CDN 对静态资源的长缓存。升级 reader 样式或脚本时必须同步提升插件版本。

## 数据真源

- 文章真源：`Post`
- 私密正文真源：`Post.metadata.annotations["privateposts.halo.run/bundle"]`
- 镜像资源：`PrivatePost`

`PrivatePost` 只服务于列表、按 slug 匿名读取和主题接管。写入时必须先维护 `Post` 注解，再同步镜像，不能只更新 `PrivatePost`。
