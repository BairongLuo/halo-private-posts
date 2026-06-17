# Smoke Test

本文档是发布前的最低回归清单。

保存与加密相关的行为标准，另见 [SAVE_ENCRYPTION_CONTRACT.md](SAVE_ENCRYPTION_CONTRACT.md)。
改动类型与自动化门槛，另见 [QUALITY_GATES.md](QUALITY_GATES.md)。

## 自动化入口

发版前先执行：

```bash
./gradlew verifyAll
```

覆盖：

- 跑文档规范校验
- 跑完整 `build`
- 验证插件 JAR 已产出
- 验证包内包含 `plugin.yaml`、console 资源和 reader 资源

快速检查用：

```bash
./gradlew quickCheck
```

快速检查通过后，再进入真实 Halo 环境回归。

本地有 Halo 开发容器时，可以跑：

```bash
./scripts/dev-container-smoke.sh
```

覆盖：

- `./gradlew smokeCheck`
- 按需复用、启动或创建 Halo 开发容器
- `./gradlew reloadPlugin`
- Halo 存活检查
- reader 静态资源与私密路由挂载检查
- 匿名 reader 页和 bundle JSON 路由在 `404` 场景下也返回 `Cache-Control: no-store`

`smokeCheck` 会先跑完整 `build`；`build` 包含 `check`，所以前端 `typeCheckUi` 和 `testUi` 也会被覆盖。脚本从 `settings.gradle` 读取 `rootProject.name` 确认容器插件目录，再从 `plugin.yaml` 读取插件名验证 reader 资源路径。

如果脚本提示 `build mount is stale`，说明当前 Halo 开发容器已经不适合继续热重载。默认行为是直接停止并给出修复命令；只有在你明确接受重建容器时，才使用：

```bash
RECREATE_CONTAINER_ON_STALE_MOUNT=1 ./scripts/dev-container-smoke.sh
```

要验证后台登录、平台恢复重置和独立阅读页解锁，再执行：

```bash
./gradlew installPlaywrightUi
./gradlew testE2eUi
```

完整验收用：

```bash
./scripts/dev-container-acceptance.sh
```

覆盖：

- `./scripts/dev-container-smoke.sh`
- `./gradlew testE2eUi`
- `./scripts/dev-container-uninstall-smoke.sh`

`testE2eUi` 当前覆盖：

- 后台登录后，文章列表三点菜单中的“文章加密”入口会跳转到编辑器并打开设置里的加密模块
- 后台登录后，点击文章列表里的“未加锁”状态标签，会跳转到编辑器并自动打开设置里的加密模块
- 后台登录后，通过平台恢复能力重置已加锁文章的访问口令
- 访问公开的 `/private-posts?slug=...` 独立阅读页，并验证错误口令失败、正确口令解锁成功

`testE2eUi` 目前还没有覆盖编辑页正文保存和设置面板元数据保存。修改保存逻辑后，必须额外执行本文末尾的保存回归矩阵。

前端单元测试里，`ui/src/annotation/mount.test.ts` 覆盖编辑页设置面板和 `/console/posts` 文章列表原生设置抽屉的挂载逻辑。

`dev-container-uninstall-smoke.sh` 会执行破坏性卸载演练：

- 先创建一篇真实已加锁文章
- 删除开发容器里的插件资源，验证卸载前已经移除文章注解
- 检查 Halo 日志中没有 `Completed uninstall cleanup ... with failures` 和 `Scheme not found for privateposts.halo.run/v1alpha1/PrivatePost`
- 最后重启开发容器，让挂载目录中的开发插件自动重新装回

默认环境变量：

- `HALO_BASE_URL=http://localhost:8090`
- `HALO_E2E_USERNAME=admin`
- `HALO_E2E_PASSWORD=Admin12345!`

如需覆盖，可在命令前注入环境变量。

也可以手动触发 GitHub Actions workflow：`.github/workflows/full-regression.yml`。

## 人工回归范围

记录以下信息：

- Halo 版本
- 当前主题名称
- 插件版本

## 检查清单

1. 安装并启用插件。
   预期：文章列表三点菜单中的“文章加密”入口，以及“已加锁 / 未加锁”状态标签，都可点击跳转到编辑器，并自动打开设置里的“文章加密”模块。直接在 `/console/posts` 文章列表中打开原生文章设置抽屉，也能看到同一个“文章加密”模块。后台菜单不再额外暴露私密文章页面。

2. 新建一篇公开文章并保存正文。
   预期：未加锁时原文章页仍是普通正文。

3. 点击文章列表状态标签进入编辑器，在设置面板里勾选“启用文章加密”，输入访问口令后点击 Halo 原生保存。
   预期：设置成功，文章列表状态更新，原文章页切为锁定态。

4. 在原文章页输入错误口令。
   预期：解锁失败，页面不泄露正文。

5. 在原文章页输入正确口令。
   预期：正文在浏览器内解锁，刷新或切后台后会重新锁定。

6. 打开独立阅读页 `/private-posts?slug=...`。
   预期：可以使用同一访问口令解锁，接口响应不被缓存。

7. 直达隐藏的后台恢复兜底页 `/console/private-posts`，用平台恢复重置访问口令。
   预期：旧口令失效，新口令立即生效。

8. 返回编辑器设置面板，取消“启用文章加密”后点击 Halo 原生保存。
   预期：原文章页恢复普通正文，`PrivatePost` 镜像被清理。

9. 如本次演练包含卸载，再删除插件。
   预期：日志显示卸载清理完成；若失败，按 [OPERATIONS.md](OPERATIONS.md) 的人工恢复步骤处理。

## 保存回归矩阵

每次修改保存链路，至少再执行下面 8 项：

1. 主编辑器直接保存正文。
   预期：未加密文章正常保存，不生成 bundle。

2. 已发布的加密文章,在主编辑器改草稿正文后仅保存(不发布)。
   预期：密文不变,公开页解锁后仍显示上一次已发布的正文(未发布的草稿不泄露)。

3. 同上文章点「发布」。
   预期：密文按新发布的正文重算,公开页解锁显示新正文。

4. 设置面板启用加密后点击保存。
   预期：文章已有已发布正文时,即使本次请求只有元数据,也按已发布内容生成 bundle;文章从未发布时明确失败,提示先发布文章。

5. 设置面板修改标题或 slug 后点击保存。
   预期：已加密文章保存后，bundle metadata 同步更新,密文按已发布内容重算。

6. 打开编辑器设置面板。
   预期：能看到“文章加密”模块，但看不到内部 bundle 原始字段。

7. 打开 `/console/posts` 文章列表中的原生文章设置抽屉。
   预期：能看到“文章加密”模块，但看不到内部 bundle 原始字段。

8. 新建从未发布的文章，在设置面板启用加密后点击保存。
   预期：明确失败并提示先发布文章，不能静默用草稿加密。

## 发布门槛

满足以下条件后再考虑公开发布：

- `./gradlew verifyAll` 通过
- 人工清单在目标 Halo 版本和至少一个真实主题下通过
- 升级与卸载路径都已演练
- 文档、安全边界和恢复模型描述一致
