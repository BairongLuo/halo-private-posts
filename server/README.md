# 服务端集成

当前服务端已经实现这些职责：

- 插件生命周期与自定义模型注册
- `PrivatePost` 自定义模型定义
- `spec.slug` / `spec.postName` 唯一索引
- `spec.publishedAt` 普通索引
- Halo 扩展资源 `privateposts.halo.run/v1alpha1`
- 插件启动时的残留清理与镜像补重建
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

### 匿名阅读入口

- `GET /private-posts?slug=...`
  - 渲染默认锁定态阅读页模板
  - 返回 `Cache-Control: no-store`
- `GET /private-posts/data?slug=...`
  - 返回阅读页所需的 `PrivatePostView`
  - 返回 `Cache-Control: no-store`

两个入口都只会暴露“源 `Post` 仍处于可公开访问状态”的私密正文镜像。

当前模型职责：

- `metadata.name`：统一使用 `postName`
- `postName`：关联 Halo 文章
- `slug/title/excerpt/publishedAt`：公开元数据冗余字段
- `bundle`：完整 `EncryptedPrivatePostBundle`

`PrivatePost` 仍然只是镜像，不是正文真源。正文 bundle 的真实持久化位置仍是文章注解 `privateposts.halo.run/bundle`。

## 同步与清理

- 作者侧 UI 会先写文章注解，再立即 upsert `PrivatePost`，让控制台状态和前台阅读入口尽快一致
- `PostPrivatePostSyncListener` 会在文章更新、发布、取消发布、可见性变化和删除时继续同步或清理镜像
- 插件启动时会先删掉失效映射，再按现存源文章重建缺失镜像
- 删除镜像时会兼容软删除残留和旧 schema 校验失败，尽量把后台幽灵记录清掉

## 当前实现边界

服务端只负责存储映射、状态校验、残留清理、分发视图模型和暴露阅读入口，不负责作者侧加密流程。

未做内容：

- 服务端托管访问口令
- 第二套独立正文编辑系统
- 多成员密钥撤销、审计和生命周期管理

当前额外约束：

- 服务端会保存站点恢复私钥，用于后台平台恢复重置访问口令
- 站点恢复私钥只保存在服务端 Secret `halo-private-posts-site-recovery`
