# 维护说明

这个项目现在已经收敛到比较明确的一条路：它不是第二套文章系统，而是给 Halo 原生文章补上“私密正文”能力。文章本身还是 `Post`，私密内容以 bundle 的形式放在文章注解里；服务端的 `PrivatePost` 只是镜像和读取视图，用来给前台和后台消费，不负责反向编辑正文。

## 先记住这些约束

- 当前只支持 `EncryptedPrivatePostBundle v2`。
- bundle 的真源是 `Post.metadata.annotations["privateposts.halo.run/bundle"]`。
- `PrivatePost` 只能反映文章状态，不能再变回单独的正文编辑入口。
- 阅读端公开交互只保留密码解锁，不再暴露作者钥匙入口。
- 服务端不保存访问口令，也不保存作者私钥。
- 现在的作者钥匙模型是“每个账号默认一把隐藏钥匙”，没有单独的管理界面。
- 旧 `v1` 兼容链路、旧块标签提取、旧编辑器入口都已经删掉，不要默认再加回来。

## 主要入口

`ui/src/annotation/PrivatePostAnnotationTool.vue` 是文章设置里的加锁入口。现在的加锁动作就是在这里读取当前文章正文、生成 `v2 bundle`、写回文章注解，并把当前账号默认作者公钥对应的 `author_slots[]` 一起写进去。

`src/main/java/run/halo/privateposts/sync/PostPrivatePostSyncListener.java` 负责把文章注解同步成 `PrivatePost`。文章保存、发布、删除后，这里会决定创建、更新还是删除镜像数据，所以只要出现“设置里看着生效，实际文章没生效”这类问题，通常先看这里。

原文章页的锁定态和原位解锁，主要在这几处：

- `src/main/java/run/halo/privateposts/theme/InlinePrivatePostContentHandler.java`
- `src/main/java/run/halo/privateposts/theme/PrivatePostReaderAssetsHeadProcessor.java`
- `ui/src/reader.ts`

前两者负责把 reader 资源挂到主题页面里，并在正文区域输出锁定态；真正的浏览器端解锁、自动重锁和渲染在 `ui/src/reader.ts`。

后台的“重设/覆盖口令”在 `ui/src/views/PrivatePostsView.vue`。这里不会回显旧口令，也不会重新加密正文本体，只会依赖当前浏览器里保存的隐藏作者私钥恢复 `CEK`，然后重写 `password_slot`，最后再把 bundle 同步回文章注解和 `PrivatePost`。

和密码学直接相关的逻辑主要集中在下面几个文件：

- `ui/src/utils/private-post-crypto.ts`
- `ui/src/utils/author-key-crypto.ts`
- `ui/src/utils/default-author-key.ts`
- `ui/src/utils/author-key-store.ts`

这里分别处理 bundle 校验、正文加解密、密码槽包裹、作者钥匙包裹，以及默认隐藏作者钥匙的初始化和本地存储。

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
- 不要把作者私钥上传到服务端。当前恢复链路就是浏览器本地私钥包裹同一个 `CEK`。
- 不要在公开阅读页再加作者钥匙解锁入口。现在对外只保留密码这一条。
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
