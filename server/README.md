# 服务端集成

当前服务端已经实现这些职责：

- 插件生命周期与自定义模型注册
- `PrivatePost` 自定义模型定义
- `spec.slug` / `spec.postName` 唯一索引
- `spec.publishedAt` 普通索引
- Halo 扩展资源 `privateposts.halo.run/v1alpha1`
- 查询型 `CustomEndpoint`：`api.privateposts.halo.run/v1alpha1`
- 主题 Finder `haloPrivatePostFinder`
- 默认前台阅读页路由 `/private-posts?slug=...`
- 匿名 bundle JSON 路由 `/private-posts/data?slug=...`
- reader 静态资源代理 `/plugins/halo-private-posts/assets/reader/*`

## 已落地接口

### Halo 扩展资源

Console 管理页直接使用 Halo 标准扩展资源接口：

- `GET /apis/privateposts.halo.run/v1alpha1/privateposts`
- `POST /apis/privateposts.halo.run/v1alpha1/privateposts`
- `PUT /apis/privateposts.halo.run/v1alpha1/privateposts/{name}`
- `DELETE /apis/privateposts.halo.run/v1alpha1/privateposts/{name}`

### 查询型 CustomEndpoint

插件额外注册了 `groupVersion = api.privateposts.halo.run/v1alpha1` 的查询接口，路由函数定义为：

- `GET /private-posts`
  - 不带 `slug` 时返回 `PrivatePostView[]`
  - 带 `slug` 时返回单个 `PrivatePostView`

最终挂载路径由 Halo 统一暴露在 `/apis/...` 下。

### 匿名阅读入口

- `GET /private-posts?slug=...`
  - 渲染默认锁定态阅读页模板
- `GET /private-posts/data?slug=...`
  - 返回阅读页所需的 `PrivatePostView`

当前模型职责：

- `postName`：关联 Halo 文章
- `slug/title/excerpt/publishedAt`：公开元数据冗余字段
- `bundle`：完整 `EncryptedPrivatePostBundle`

## 当前实现边界

服务端只负责存储映射、分发视图模型和暴露阅读入口，不负责作者侧加密流程。

未做内容：

- 直接嵌入 Halo 原生文章编辑器
- 保存前自动加密
- 主题内自动替换文章正文
