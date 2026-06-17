# 维护

这个项目只做一件事：在 Halo 原生文章上补上“私密正文”能力。文章本身仍然是 `Post`；私密内容写在文章注解里。`PrivatePost` 只是镜像和读取视图，不负责反向编辑正文。

## 约束

- 当前只支持 `EncryptedPrivatePostBundle v3`。
- 当前正文 payload 只支持 `markdown` 和 `html` 两种格式。
- bundle 的真源是 `Post.metadata.annotations["privateposts.halo.run/bundle"]`。
- `PrivatePost` 只能反映文章状态，不能再变回单独的正文编辑入口。
- `PrivatePost.metadata.name` 统一等于 `spec.postName`。
- 阅读端公开交互只保留密码解锁。
- 服务端不保存访问口令，但会保存站点恢复私钥。
- 平台恢复重置口令必须走服务端，不要把 `CEK` 或恢复私钥暴露到浏览器。
- 加密密文始终基于**已发布(released)内容**。Halo 区分草稿(`headSnapshot`)和已发布(`releaseSnapshot`)快照,公开页只显示已发布内容;首次加密和密文刷新都读已发布正文,仅保存草稿不重算密文,发布时才用即将发布的快照重算。文章从未发布时禁止加密,需提示先发布。

## 主要入口

`ui/src/annotation/PrivatePostAnnotationTool.vue` 是文章设置里的“文章加密”模块。它会出现在编辑页设置面板，也会出现在 `/console/posts` 文章列表的原生设置抽屉。文章列表状态标签和操作菜单负责跳转到编辑器并自动打开设置模块；如果用户直接打开原生设置抽屉，`ui/src/annotation/mount.ts` 会在检测到隐藏 bundle 字段后补一个设置区 fallback slot，再挂载同一套模块。加锁时，这里会读取当前或已保存的 Markdown / HTML 正文，生成 `v3 bundle`，写回文章注解，并同时写入 `password_slot` 和 `site_recovery_slot`。

保存顺序：

- 加锁：先持久化 bundle 注解，再按 `postName` upsert `PrivatePost`；如果镜像写入失败，会把注解回滚到旧值
- 取消加锁：先移除 bundle 注解，再按 `postName` 最佳努力补删所有 `PrivatePost`；`404` 视为已清理，不应该再冒泡成英文全局错误弹窗

`src/main/java/run/halo/privateposts/sync/PostPrivatePostSyncListener.java` 负责把文章注解同步成 `PrivatePost`。它只接受 `v3 + site_recovery_slot`。如果这里回退，后台列表、阅读接口和启动补扫都会偏掉。

`src/main/java/run/halo/privateposts/model/PrivatePostBundleValidator.java` 是同步链路和公开读取链路的入口校验器。它不只检查字段是否存在，还会检查：

- `v3` 版本是否正确
- `payload_format / cipher / kdf / site_recovery_slot.alg` 是否属于当前支持集合
- `data_iv / auth_tag / password_slot / site_recovery_slot.wrapped_cek` 的 hex 长度是否符合当前协议

这意味着以前那种测试占位数据、历史手工脏数据、或者只长得像 bundle 但长度明显不可能的假数据，都会被判定为无效，不会再进入同步、阅读或平台恢复链路。后台平台恢复路由也执行同一套 `v3` 规则，只是把校验逻辑收在 router 本地，避免 Halo 开发容器热重载时共享 validator 再次类加载失败。

## 平台恢复

平台恢复分成三块：

- `src/main/java/run/halo/privateposts/service/SiteRecoveryKeyService.java`
- `src/main/java/run/halo/privateposts/service/PasswordSlotCryptoService.java`
- `src/main/java/run/halo/privateposts/router/PrivatePostConsoleRouter.java`

语义是：

- `SiteRecoveryKeyService` 负责生成和持久化站点恢复 RSA 密钥对，并提供恢复公钥给前端
- `PasswordSlotCryptoService` 负责服务端重写 `password_slot`
- `PrivatePostConsoleRouter` 提供后台恢复接口，并在重置口令时同时回写文章真实注解和 `PrivatePost` 镜像

注意：不要只更新 `PrivatePost`，必须同步更新 `Post.metadata.annotations["privateposts.halo.run/bundle"]`。文章注解才是真源。

如果后台重置口令返回“当前文章还没有有效的私密正文 bundle，请重新加锁后再使用平台恢复”，先检查源文章注解里的 bundle 是否本来就是占位数据、历史脏数据，或者没有通过当前 `v3` 校验。

## `PrivatePost` 清理

`PrivatePost` 只是镜像，不应该比源 `Post` 活得更久。下面几种情况都会被清理：

- 源文章不存在
- 源文章 `spec.deleted = true`
- 源文章已进入回收站，例如 `content.halo.run/deleted = true`
- 源文章已经没有 `privateposts.halo.run/bundle` 注解

当前实现分两层：

- 事件清理：文章更新、发布、取消发布、可见性变化、删除时即时同步
- 启动清理：插件启动时补扫历史残留，避免旧脏数据一直出现在控制台

还要注意 Halo 扩展资源的软删除语义。删除 `PrivatePost` 后，资源可能先残留为带 `deletionTimestamp` 的软删除项。当前实现已经做了三件事：

- 列表和按 `postName` 查找默认忽略软删除项，避免它们污染后台状态和再次加锁逻辑
- 再次加锁前会先清理同 `postName` 下的软删除残留，再做创建或更新
- 取消加锁和后台清理都会对同一资源名连续尝试两次删除，尽量把软删除推进到真正移除

## 前端职责

`ui/src/views/PrivatePostsView.vue` 只保留平台恢复口令维护入口：

- 直接调用后台平台恢复接口重写 `password_slot`
- 不再出现在 Halo 后台主菜单中，只保留直达 `/console/private-posts` 的隐藏后台恢复兜底路由

不要把平台恢复做成浏览器私钥解包模式。浏览器端只负责写入 `site_recovery_slot`，不持有恢复私钥。

## 常见错误

- 不要把 `PrivatePost` 当成正文真源。
- 不要在公开阅读页再加恢复入口。
- 不要把站点恢复私钥下发到浏览器。
- 不要把停用、升级、删除混成一个生命周期处理。

## 提交前至少跑一下

前端或协议有变动时，至少执行：

```bash
cd ui
npm run type-check
```

涉及服务端或整包行为时，再补：

```bash
./gradlew test
./gradlew build
```
