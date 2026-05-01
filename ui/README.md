# 前端界面

`ui/` 现在包含三块前端能力：

1. 隐藏后台恢复页
   - 展示已加密文章
   - 后台平台恢复重置访问口令
2. 文章设置里的私密正文工具
   - 在编辑器设置面板里勾选启用或取消启用文章加密
   - 跟随 Halo 原生保存自动维护注解里的 `bundle`
3. 前台 reader
   - 原文章页内联锁定态
   - 独立阅读页
   - 浏览器本地解密与自动重锁

## 隐藏恢复页

- 入口：`src/index.ts`
- 主视图：`src/views/PrivatePostsView.vue`
- 数据源：
  - Halo 扩展资源 `/apis/privateposts.halo.run/v1alpha1/privateposts`
  - Console 恢复接口 `/apis/api.console.halo.run/v1alpha1/private-posts/*`
- 能力：
  - 通过 `post:list-item:field:create` 在文章列表显示私密正文状态
  - 按 `postName` 载入真实 Halo 文章信息
  - 通过平台恢复接口重写 `password_slot`
  - 不再出现在 Halo 后台菜单中，只保留直达路由作为恢复兜底

## 文章设置工具

- 入口：`src/annotation/PrivatePostAnnotationTool.vue`
- 挂载：`src/annotation/mount.ts`
- 能力：
  - 在编辑器设置面板注入“文章加密”模块
  - 主编辑器保存正文和设置面板保存元数据两条链路都能识别
  - 首次加锁时浏览器本地生成 `EncryptedPrivatePostBundle v3`
  - 已加密文章再次保存时调用服务端恢复链路重算密文
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
  - 隐藏后台恢复页和口令维护流
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
