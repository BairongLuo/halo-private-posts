# 前端界面

`ui/` 现在包含两套前端入口：

1. Halo Console 插件页
   - 录入私密文章映射
   - 粘贴 `EncryptedPrivatePostBundle`
   - 本地输入密码验证解锁
   - Markdown 预览
2. 前台 reader
   - 锁定态页面
   - 浏览器本地解密
   - 页面隐藏、离开和空闲超时重锁

## Console 页

- 入口：`src/index.ts`
- 主视图：`src/views/PrivatePostsView.vue`
- 数据源：Halo 扩展资源 `/apis/privateposts.halo.run/v1alpha1/privateposts`
- 能力：
  - 通过 `post:list-item:field:create` 在文章列表显示私密正文状态
  - 从文章列表跳转到对应文章的私密正文配置页
  - 按 `postName` 载入真实 Halo 文章信息
  - 维护 `postName -> bundle` 映射
  - 解析并校验 bundle JSON
  - 本地输入密码做解锁验证
  - 用 `marked` 做 Markdown 预览

## Reader 页

- 入口：`src/reader.ts`
- 样式：`src/reader.css`
- 数据源：匿名阅读接口 `/private-posts/data?slug=...`
- 行为：
  - 读取锁定页模板注入的 bundle 地址和超时配置
  - 浏览器本地执行 `scrypt + AES-GCM`
  - 标签页隐藏、页面离开和空闲超时后自动清空明文状态
  - 通过 CSS 变量接收主题覆盖，而不是固定写死整套颜色

## 关键实现

- `src/utils/private-post-crypto.ts`
  - `scrypt-js`
  - Web Crypto `AES-GCM`
  - `ZKVault v1` bundle 解析与校验
- `src/components/PostPrivateBodyField.vue`
  - Halo 文章列表里的私密正文状态字段
- `src/stores/private-post-registry.ts`
  - 私密正文映射缓存，供文章列表字段复用
- `src/api/posts.ts`
  - 读取 Halo 文章列表和文章详情
- `src/views/PrivatePostsView.vue`
  - Console 管理页和文章绑定流
- `src/reader.ts`
  - 前台阅读页挂载和重锁逻辑

## 可用命令

```bash
npm install
npm run type-check
npm run test:unit
npm run build
```

`npm run build` 会同时生成：

- `ui/build/dist`：Halo Console 插件页产物
- `ui/dist-reader`：前台 reader 静态资源
