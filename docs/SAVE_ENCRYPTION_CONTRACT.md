# 保存与加密契约

本文档定义文章保存、私密正文同步和加密面板显示的明确标准。后续改动必须同时满足这里的行为约束和回归测试矩阵。

## 目标

- 修一个保存相关问题时，不能破坏其他保存入口。
- 加密状态的真源只能是 `Post.metadata.annotations["privateposts.halo.run/bundle"]`。
- 已加密文章的密文更新必须优先走服务端恢复链路，不能依赖前端缓存的旧正文。

## 数据真源

1. `Post` 是文章真源。
2. `privateposts.halo.run/bundle` 是私密正文 bundle 真源。
3. `PrivatePost` 只是镜像和读取视图，不能单独作为写入目标。
4. `site recovery private key` 只允许保存在服务端；浏览器只能拿恢复公钥。

## 保存入口标准

### 1. 主编辑器保存正文

- 请求：`PUT /apis/api.console.halo.run/v1alpha1/posts/{name}/content`
- 请求体：`Content`
- 标准：
- 未启用加密：正常保存正文，不改 bundle。
- 首次加密：使用本次请求里的最新正文在浏览器生成 bundle，并写回文章注解。
- 已加密再次保存：正文先正常保存，再由服务端用恢复私钥解包旧 `CEK`，按最新正文重算密文。

### 2. 设置面板保存元数据

- 请求：`PUT /apis/content.halo.run/v1alpha1/posts/{name}`
- 请求体：`Post`
- 标准：
- 未启用加密：正常保存元数据，不改 bundle。
- 首次加密：因为请求体不带正文，必须读取服务端已保存正文进行加密，不能依赖前端缓存。
- 已加密再次保存：必须走服务端恢复链路重算 bundle，并同步新的公开 metadata。

### 3. 新建文章后首次保存正文

- 请求：`POST /apis/api.console.halo.run/v1alpha1/posts`
- 请求体：`PostRequest`
- 标准：
- 如果用户已启用加密并填写访问口令，可以直接使用请求体里的正文完成首次加密。

### 4. 新建文章时只保存元数据

- 请求：`POST /apis/content.halo.run/v1alpha1/posts`
- 请求体：`Post`
- 标准：
- 如果服务端还没有已保存正文，不允许静默成功。
- 必须明确报错：先保存正文，再启用加密。

## UI 标准

1. 设置面板里必须能看到“文章加密”模块。
2. 内部 bundle 字段必须隐藏，不能把自动维护密文暴露给用户。
3. 状态文案要和真实动作一致：
- 首次启用：`保存后加锁`
- 已加密再保存：`保存后更新密文`
- 取消加密：`保存后解锁`

## 失败语义标准

1. 加密准备失败时，不能继续把保存请求静默放行成“看起来保存成功”。
2. 如果正文已保存但 bundle 同步失败，必须明确提示“正文保存成功，但加密同步失败”。
3. 不允许只更新 `PrivatePost` 而不更新源 `Post` 注解。

## 自动化测试矩阵

### 前端

- `ui/src/annotation/editor-dom.test.ts`
  - 目标：保存按钮、设置按钮、入口挂载点识别不能回归。
- `ui/src/annotation/mount.test.ts`
  - 目标：设置面板可见，内部 bundle 字段隐藏，但不能把整个模块隐藏掉。
- `ui/src/annotation/bundle-field-sync.test.ts`
  - 目标：bundle optimistic sync 不被旧 DOM 值回滚。
- `ui/src/annotation/metadata-save.test.ts`
  - 目标：元数据保存请求体识别、保存入口识别、首次加密时服务端正文回退。

### 服务端

- `src/test/java/run/halo/privateposts/router/PrivatePostConsoleRouterTest.java`
  - 目标：`refresh-bundle` 使用恢复私钥链路，并在缺少正文载荷时回退到 `PostContentService.getHeadContent(postName)`。

## 人工回归矩阵

每次改保存链路，至少手工验证下面 6 项：

1. 主编辑器保存正文，未加密文章保持普通保存。
2. 主编辑器保存正文，已加密文章密文同步更新。
3. 设置面板保存元数据，首次加密成功生成密文。
4. 设置面板保存元数据，已加密文章密文同步更新。
5. 设置面板仍能看到“文章加密”模块，内部 bundle 字段不可见。
6. 新建但未保存正文的文章，在设置面板启用加密时明确失败，不得静默成功。
