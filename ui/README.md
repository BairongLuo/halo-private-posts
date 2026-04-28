# 前端界面

`ui/` 现在包含三块前端能力：

1. Halo Console 插件页
   - 展示已加密文章
   - 后台平台恢复重置访问口令
2. 文章设置里的私密正文工具
   - 在当前文章上直接加锁或取消加锁
   - 直接维护注解里的 `bundle`
3. 前台 reader
   - 原文章页内联锁定态
   - 独立阅读页
   - 浏览器本地解密与自动重锁

## Console 页

- 入口：`src/index.ts`
- 主视图：`src/views/PrivatePostsView.vue`
- 数据源：
  - Halo 扩展资源 `/apis/privateposts.halo.run/v1alpha1/privateposts`
  - Console 恢复接口 `/apis/api.console.halo.run/v1alpha1/private-posts/*`
- 能力：
  - 通过 `post:list-item:field:create` 在文章列表显示私密正文状态
  - 从文章列表跳转到对应文章的私密正文配置页
  - 按 `postName` 载入真实 Halo 文章信息
  - 通过平台恢复接口重写 `password_slot`

## 文章设置工具

- 入口：`src/annotation/PrivatePostAnnotationTool.vue`
- 挂载：`src/annotation/mount.ts`
- 能力：
  - 读取当前文章正文
  - 浏览器本地生成 `EncryptedPrivatePostBundle v3`
  - 直接写回 `privateposts.halo.run/bundle`
  - 自动写入 `password_slot` 和 `site_recovery_slot`

## Reader

- 入口：`src/reader.ts`
- 样式：`src/reader.css`
- 数据源：匿名阅读接口 `/private-posts/data?slug=...`
- 行为：
  - 读取模板注入的 bundle 地址和超时配置
  - 浏览器本地执行 `scrypt + AES-GCM`
  - 标签页隐藏、页面离开和空闲超时后自动清空明文状态
  - 通过 CSS 变量接收主题覆盖，而不是固定写死整套颜色

## 关键实现

- `src/utils/private-post-crypto.ts`
  - `EncryptedPrivatePostBundle v3` 生成、解析、校验和加解密
- `src/components/PostPrivateBodyField.vue`
  - Halo 文章列表里的私密正文状态字段
- `src/views/PrivatePostsView.vue`
  - Console 管理页和口令维护流
- `src/reader.ts`
  - 阅读页挂载和自动重锁逻辑

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
