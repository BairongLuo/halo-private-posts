# 维护说明

这个项目现在已经收敛到比较明确的一条路：它不是第二套文章系统，而是给 Halo 原生文章补上“私密正文”能力。文章本身还是 `Post`，私密内容以 bundle 的形式放在文章注解里；服务端的 `PrivatePost` 只是镜像和读取视图，用来给前台和后台消费，不负责反向编辑正文。

## 先记住这些约束

- 当前只支持 `EncryptedPrivatePostBundle v2`。
- bundle 的真源是 `Post.metadata.annotations["privateposts.halo.run/bundle"]`。
- `PrivatePost` 只能反映文章状态，不能再变回单独的正文编辑入口。
- 阅读端公开交互只保留密码解锁，不再暴露恢复助记词入口。
- 服务端不保存访问口令，也不保存恢复助记词。
- 当前的恢复模型是“当前浏览器持有一份本地恢复状态，对应一组只显示一次的恢复助记词”。
- 旧 `v1` 兼容链路、旧块标签提取、旧编辑器入口都已经删掉，不要默认再加回来。

## 主要入口

`ui/src/annotation/PrivatePostAnnotationTool.vue` 是文章设置里的加锁入口。现在的加锁动作就是在这里读取当前文章正文、生成 `v2 bundle`、写回文章注解，并同时写入 `password_slot` 和 `recovery_slot`。

`src/main/java/run/halo/privateposts/sync/PostPrivatePostSyncListener.java` 负责把文章注解同步成 `PrivatePost`。文章保存、发布、删除后，这里会决定创建、更新还是删除镜像数据，所以只要出现“设置里看着生效，实际文章没生效”这类问题，通常先看这里。

## `PrivatePost` 残留清理语义

`PrivatePost` 只是文章私密正文的镜像，不应该比源 `Post` 活得更久。下面几种情况都会被判定为应清理：

- 源文章不存在
- 源文章 `spec.deleted = true`
- 源文章已进入回收站，例如 `content.halo.run/deleted = true`
- 源文章已经没有 `privateposts.halo.run/bundle` 注解

当前实现分成两层：

- 事件清理：文章更新、发布、取消发布、可见性变化、删除时即时同步
- 启动清理：插件启动时补扫历史残留，避免旧脏数据一直出现在控制台

有一类历史数据要特别注意：旧版本 `PrivatePost` 结构可能和当前 schema 不一致，Halo 在 `client.delete(...)` 前会先做 schema 校验，导致正常删除直接失败。当前实现会先尝试正常删除；如果命中这类校验异常，再降级到 extension store 级别删除，避免“文章已经删了，但后台列表还留着”的长期残留。

如果后台“已加密文章”里仍然出现幽灵记录，排查顺序建议固定为：

- 先看源 `Post` 是否已经删除、回收，或者 bundle 注解是否已移除
- 再看插件启动日志里是否出现 `Failed to cleanup stale private post mappings on startup`
- 最后再直接检查 `extensions` 表里的 `PrivatePost` 行，而不是先怀疑前端缓存

原文章页的锁定态和原位解锁，主要在这几处：

- `src/main/java/run/halo/privateposts/theme/InlinePrivatePostContentHandler.java`
- `src/main/java/run/halo/privateposts/theme/PrivatePostReaderAssetsHeadProcessor.java`
- `ui/src/reader.ts`

前两者负责把 reader 资源挂到主题页面里，并在正文区域输出锁定态；真正的浏览器端解锁、自动重锁和渲染在 `ui/src/reader.ts`。

后台的口令维护在 `ui/src/views/PrivatePostsView.vue`。这里不会回显旧口令，也不会重新加密正文本体，而是支持两条路：知道旧口令时直接解开 `password_slot` 后重写；忘记旧口令时依赖当前输入的恢复助记词解开 `recovery_slot` 后重写。最后再把 bundle 同步回文章注解和 `PrivatePost`。

和密码学直接相关的逻辑主要集中在下面几个文件：

- `ui/src/utils/private-post-crypto.ts`
- `ui/src/utils/recovery-phrase.ts`
- `ui/src/utils/recovery-secret-store.ts`

这里分别处理 bundle 校验、正文加解密、密码槽包裹、恢复槽包裹，以及恢复助记词的派生和本地存储。

插件卸载时的清理逻辑在：

- `src/main/java/run/halo/privateposts/HaloPrivatePostsPlugin.java`
- `src/main/java/run/halo/privateposts/cleanup/PluginUninstallCleanupService.java`

现在的语义是，只有真正删除插件时才尝试清理；停用、升级、重启都不走这一条。清理目标是让文章回到普通文章状态，不是再引入一套额外的正文存储。

## 已经明确放弃的方案

下面这些东西已经是历史包袱，不要默认恢复：

- `v1` bundle 兼容
- 从正文 HTML 里回捞 `halo-private-post-block`
- 旧的 `ui/src/editor/*` 迁移入口
- “兼容阅读页”“兼容迁移”这一类产品表述

如果后面真的要把其中某条重新带回来，应该把它当成新需求，而不是顺手补兼容。

## 改动时容易踩的点

- 不要把 `PrivatePost` 当成正文真源。真正需要持久化的 bundle 还是文章注解。
- 不要把恢复助记词或恢复熵上传到服务端。当前恢复链路就是浏览器本地恢复秘密包裹同一个 `CEK`。
- 不要在公开阅读页再加恢复助记词入口。现在对外只保留密码这一条。
- 不要把“停用插件”“升级插件”“删除插件”混成同一个生命周期处理。

## 提交前至少跑一下

前端或协议有变动时，至少执行：

```bash
cd ui
npm run type-check
npm run test:unit
```

涉及服务端或整包行为时，再补：

```bash
./gradlew test
./gradlew build
```

## 当前判断

这套实现的主链路已经能用，但仓库状态更适合按自用 beta / RC 看待。对外发布前，最好还是继续用真实 Halo 环境做回归，尤其是主题接管、文章保存链路和插件删除收尾这几块。
