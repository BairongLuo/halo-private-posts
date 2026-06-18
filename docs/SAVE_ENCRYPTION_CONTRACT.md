# 保存与加密契约

本文档约束文章保存、私密正文同步和加密面板显示。凡是改保存链路，都要同时检查这里的行为和测试矩阵。

## 目标

- 修一个保存相关问题时，不能破坏其他保存入口。
- 加密状态的真源只能是 `Post.metadata.annotations["privateposts.halo.run/bundle"]`。
- 已加密文章的密文更新必须优先走服务端恢复链路，不能依赖前端缓存的旧正文。
- 加密密文始终基于**已发布(released)内容**。Halo 文章区分草稿(`headSnapshot`)和已发布(`releaseSnapshot`)两套快照,公开页只显示已发布内容;密文绝不能用未发布的草稿正文生成,否则读者解锁后会看到未发布内容。

## 数据真源

1. `Post` 是文章真源。
2. `privateposts.halo.run/bundle` 是私密正文 bundle 真源。
3. `PrivatePost` 只是镜像和读取视图，不能单独作为写入目标。
4. `site recovery private key` 只允许保存在服务端；浏览器只能拿恢复公钥。

## 保存入口标准

### 1. 主编辑器保存正文

- 请求：`PUT /apis/api.console.halo.run/v1alpha1/posts/{name}/content`
- 请求体：`Content`

行为：

- 未启用加密：正常保存正文，不改 bundle。
- 首次加密：读取服务端**已发布(released)正文**生成 bundle，并写回文章注解;忽略本次请求体里的草稿正文。文章从未发布时,明确报错提示先发布,不静默用草稿加密。
- 已加密再次保存草稿：只更新草稿快照,**不重算密文**(公开页继续显示已发布版本)。仅当本次同时改了标题/slug/原生摘要等公开 metadata、插件锁定说明或访问密码时,才走服务端恢复链路,并按已发布快照重算密文。

### 2. 设置面板保存元数据

- 请求：`PUT /apis/content.halo.run/v1alpha1/posts/{name}`
- 请求体：`Post`

行为：

- 未启用加密：正常保存元数据，不改 bundle。
- 首次加密：因为请求体不带正文，必须读取服务端**已发布正文**进行加密;从未发布时报错提示先发布。
- 已加密再次保存：必须走服务端恢复链路按已发布快照重算 bundle，并同步新的公开 metadata。插件不改写 Halo 原生摘要字段;锁定说明写入 `bundle.metadata.description`，锁定态前台用它替代原摘要展示位置。

### 2.5 发布文章

- 请求：`PUT /apis/api.console.halo.run/v1alpha1/posts/{name}/publish?headSnapshot=...`
- 请求体：空

行为：

- 已加密文章发布时,用**即将发布的快照**(URL 中的 `headSnapshot`,发布后即成为新的 `releaseSnapshot`)重算密文,使读者解锁后看到的正是新发布的正文。

### 3. 新建文章后首次保存正文

- 请求：`POST /apis/api.console.halo.run/v1alpha1/posts`
- 请求体：`PostRequest`

行为：

- 仅当请求体正文已是文章的已发布内容时才适用。常规流程下新建文章应先发布,再启用加密。

### 4. 新建文章时只保存元数据

- 请求：`POST /apis/content.halo.run/v1alpha1/posts`
- 请求体：`Post`

行为：

- 如果服务端还没有已发布正文，不允许静默成功。
- 必须明确报错：先发布文章，再启用加密。

## UI 标准

1. 编辑页设置面板里必须能看到“文章加密”模块。
2. `/console/posts` 文章列表里的原生文章设置抽屉，如果已经渲染出 `hpp-annotation-bundle` 字段，也必须能看到同一个“文章加密”模块。
3. 内部 bundle 字段必须隐藏，不能把自动维护密文暴露给用户。
4. 状态文案要和真实动作一致：

- 首次启用：`保存后加锁`
- 已加密再保存：`保存后更新密文`
- 取消加密：`保存后解锁`

## 失败语义标准

1. 加密准备失败时，不能继续把保存请求静默放行成“看起来保存成功”。
2. 如果正文已保存但 bundle 同步失败，必须明确提示“正文保存成功，但加密同步失败”。
3. 不允许只更新 `PrivatePost` 而不更新源 `Post` 注解。
4. 文章从未发布(没有 `releaseSnapshot` / 已发布正文)时启用或刷新加密,必须明确报错提示先发布,不允许用草稿正文静默加密。

## 自动化测试矩阵

### 前端

- `ui/src/annotation/editor-dom.test.ts`
  - 目标：保存按钮、设置按钮、入口挂载点识别不能回归。
- `ui/src/annotation/mount.test.ts`
  - 目标：编辑页设置面板和 `/console/posts` 原生设置抽屉都能显示加密模块，内部 bundle 字段隐藏，但不能把整个模块隐藏掉。
- `ui/src/annotation/bundle-field-sync.test.ts`
  - 目标：bundle optimistic sync 不被旧 DOM 值回滚。
- `ui/src/annotation/metadata-save.test.ts`
  - 目标：元数据保存请求体识别、保存入口识别、以及 `resolveManagedRefreshPlan`——仅发布才用请求体草稿正文重算密文;仅保存草稿且密码/元数据未变时不触碰密文;改元数据或密码时按已发布快照重算。

### 服务端

- `src/test/java/run/halo/privateposts/router/PrivatePostConsoleRouterTest.java`
  - 目标：`refresh-bundle` 使用恢复私钥链路;请求带显式 `snapshotName`(发布路径)时用 `getSpecifiedContent`;否则按已发布内容 `PostContentService.getReleaseContent(postName)` 重算;文章未发布(`getReleaseContent` 为空)时报错提示先发布。

## 人工回归矩阵

每次改保存链路，至少手工验证下面 6 项：

1. 主编辑器保存正文，未加密文章保持普通保存。
2. 已发布的加密文章,改草稿正文后仅保存(不发布),公开页解锁后仍显示上一次已发布的正文,密文不变。
3. 同上文章点「发布」后,公开页解锁显示新发布的正文。
4. 设置面板保存元数据,改标题/slug/原生摘要/锁定说明或密码后,已加密文章按已发布快照重算密文并同步公开 metadata。
5. 编辑页设置面板和文章列表原生设置抽屉仍能看到“文章加密”模块，内部 bundle 字段不可见。
6. 新建但从未发布的文章，在设置面板启用加密时明确失败提示先发布，不得静默用草稿加密。
