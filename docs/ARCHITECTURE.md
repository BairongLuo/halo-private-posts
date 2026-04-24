# 架构设计

## 仓库角色

这个仓库是面向 Halo 的私密文章适配层。

它刻意独立于原生 `ZKVault` 仓库，以保证核心私密文章协议可以继续在 Halo 之外复用。

## 主要分层

### 服务端集成层

负责：

- Halo 插件注册
- `PrivatePost` 扩展资源定义
- `spec.slug` / `spec.postName` / `spec.publishedAt` 索引
- 匿名阅读页和匿名 bundle JSON
- Finder 与 `PrivatePostView` 组装

### 前端界面层

负责：

- Halo Console 管理页
- Halo 文章列表中的私密正文状态字段
- 锁定态文章页
- 密码输入、解密动作流和 Markdown 渲染
- 页面隐藏、离开和空闲超时重锁
- 状态和错误提示

### 协议消费层

负责：

- 校验支持的 bundle 版本
- 消费共享私密文章 bundle 格式
- 保持与 `ZKVault` fixture 的兼容性

## 当前数据模型

每篇私密文章应建模为：

- 公开元数据
  - 标题
  - slug
  - 摘要
  - 发布时间
- 加密正文
  - 共享 bundle 数据

具体字段映射可以是 Halo 专属的，但加密 bundle 格式应保持与 `ZKVault` 兼容。

当前实现将这些字段统一收敛到 `PrivatePost.spec`：

- `postName`
- `slug`
- `title`
- `excerpt`
- `publishedAt`
- `bundle`

## 当前请求流

### Console 管理流

1. Halo 文章列表通过 `post:list-item:field:create` 注入私密正文状态字段
2. 从文章列表进入插件配置页时，路由通过 `postName` 锁定当前文章
3. Console 页通过 `/apis/privateposts.halo.run/v1alpha1/privateposts` 读写 `PrivatePost`
4. 表单内本地解析 bundle 并在浏览器中解密验证
5. 保存时只把 bundle 和公开元数据写回 Halo

### 当前集成方向

当前前端已经开始从“独立映射管理页”往“增强现有 Halo 文章”收敛：

- 文章列表里直接显示私密正文状态
- 配置页支持按 `postName` 载入真实 Halo 文章信息
- reader 开始改为主题变量驱动，而不是完全自带固定配色

### 阅读流

1. 读者访问 `/private-posts?slug=...`
2. 服务端渲染 `private-post.html`，注入标题、摘要、bundle 地址和空闲超时
3. reader 再请求 `/private-posts/data?slug=...`
4. 浏览器本地完成 bundle 解密和 Markdown 渲染
5. 页面隐藏、离开或超时后清空明文内容并回到锁定态

## 边界

这个仓库不应该：

- 重新定义加密 bundle 协议
- 把 Halo 专属变更回灌到协议源头
- 让读者在运行时依赖本地原生守护进程

这个仓库可以：

- 导入来自 `ZKVault` 的共享 fixture
- 消费未来可能抽出的浏览器解密共享包
- 发布 Halo 专属的 UI 和存储行为

## 当前未覆盖范围

- Halo 原生编辑器集成
- 作者侧加密工作流
- 原文章页内原位锁定与解锁
- 发布流水线和应用市场元数据自动化

下一阶段的重点不是继续强化独立阅读页，而是把作者配置流和读者阅读流继续向原生 `Post` 体验收口。
