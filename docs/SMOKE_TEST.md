# Smoke Test

本文档定义 `halo-private-posts` 发布前的最低回归清单。

保存与加密相关的行为标准，另见 [SAVE_ENCRYPTION_CONTRACT.md](SAVE_ENCRYPTION_CONTRACT.md)。
改动类型与自动化门槛，另见 [QUALITY_GATES.md](QUALITY_GATES.md)。

## 自动化入口

先执行：

```bash
./gradlew verifyAll
```

它会：

- 跑文档规范校验
- 跑完整 `build`
- 验证插件 JAR 已产出
- 验证包内包含 `plugin.yaml`、console 资源和 reader 资源

如果你只想先跑不打包的快速检查，可以执行：

```bash
./gradlew quickCheck
```

这一步通过后，再做真实 Halo 环境人工回归。

如果你本地已经有 Halo 开发容器，也可以先跑：

```bash
./scripts/dev-container-smoke.sh
```

它会串起：

- `./gradlew smokeCheck`
- 按需复用、启动或创建 Halo 开发容器
- `./gradlew reloadPlugin`
- Halo 存活检查
- reader 静态资源与私密路由挂载检查
- 匿名 reader 页和 bundle JSON 路由在 `404` 场景下也返回 `Cache-Control: no-store`

其中 `smokeCheck` 会先跑完整 `build`；而 `build` 又会包含 `check`，所以前端 `typeCheckUi` 和 `testUi` 也已经被间接覆盖。
脚本会从 `settings.gradle` 读取 `rootProject.name` 来确认容器里的插件目录，再从 `src/main/resources/plugin.yaml` 读取 `metadata.name` 验证 `/plugins/<plugin-name>/assets/reader/*` 路径，不再依赖仓库目录名和插件标识刚好一致。

如果脚本提示 `build mount is stale`，说明当前 Halo 开发容器已经不适合继续热重载。默认行为是直接停止并给出修复命令；只有在你明确接受重建容器时，才使用：

```bash
RECREATE_CONTAINER_ON_STALE_MOUNT=1 ./scripts/dev-container-smoke.sh
```

如果要验证后台登录、隐藏后台恢复页、一次真实的平台恢复口令重置，以及独立阅读页的公开解锁流程，再执行：

```bash
./gradlew installPlaywrightUi
./gradlew testE2eUi
```

如果想把开发容器 smoke、前端回归、登录态恢复、独立阅读页 e2e 和卸载演练一次跑完，直接使用：

```bash
./scripts/dev-container-acceptance.sh
```

它会串起：

- `./scripts/dev-container-smoke.sh`
- `./gradlew testE2eUi`
- `./scripts/dev-container-uninstall-smoke.sh`

其中 `testE2eUi` 当前覆盖四条主链路：

- 后台登录后，文章列表三点菜单中不再出现“文章加密”入口
- 后台登录后，点击文章列表里的“未加锁”状态标签，会跳转到编辑器并自动打开设置里的加密模块
- 后台登录后，通过平台恢复能力重置已加锁文章的访问口令
- 访问公开的 `/private-posts?slug=...` 独立阅读页，并验证错误口令失败、正确口令解锁成功

注意：`testE2eUi` 目前还没有覆盖“编辑页正文保存”和“设置面板元数据保存”这两条加密同步链路。修改保存逻辑后，必须额外执行本文末尾的人工保存回归矩阵。

`dev-container-uninstall-smoke.sh` 会额外执行一条破坏性演练：

- 先创建一篇真实已加锁文章
- 删除开发容器里的插件资源，验证卸载前已经移除文章注解
- 检查 Halo 日志中没有 `Completed uninstall cleanup ... with failures` 和 `Scheme not found for privateposts.halo.run/v1alpha1/PrivatePost`
- 最后重启开发容器，让挂载目录中的开发插件自动重新装回

默认会使用：

- `HALO_BASE_URL=http://localhost:8090`
- `HALO_E2E_USERNAME=admin`
- `HALO_E2E_PASSWORD=Admin12345!`

如需覆盖，可在命令前注入环境变量。

仓库里还提供了手动触发的 GitHub Actions workflow：`.github/workflows/full-regression.yml`。

## 人工回归范围

记录以下信息：

- Halo 版本
- 当前主题名称
- 插件版本

## 检查清单

1. 安装并启用插件。
   预期：文章列表三点菜单中不再出现“文章加密”入口。文章列表中的“已加锁 / 未加锁”状态标签应可点击跳转到编辑器，并自动打开设置里的“文章加密”模块。后台菜单不再额外暴露私密文章页面。

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

7. 直达隐藏后台页 `/console/private-posts`，用平台恢复重置访问口令。
   预期：旧口令失效，新口令立即生效。

8. 返回编辑器设置面板，取消“启用文章加密”后点击 Halo 原生保存。
   预期：原文章页恢复普通正文，`PrivatePost` 镜像被清理。

9. 如本次演练包含卸载，再删除插件。
   预期：日志显示卸载清理完成；若失败，按 [OPERATIONS.md](OPERATIONS.md) 的人工恢复步骤处理。

## 保存回归矩阵

每次修改保存链路，至少再执行下面 6 项：

1. 主编辑器直接保存正文。
   预期：未加密文章正常保存，不生成 bundle。

2. 主编辑器直接保存正文。
   预期：已加密文章保存后，bundle 对应密文同步更新。

3. 设置面板启用加密后点击保存。
   预期：如果文章已有已保存正文，即使本次请求只有元数据，也能生成 bundle。

4. 设置面板修改标题或 slug 后点击保存。
   预期：已加密文章保存后，bundle metadata 和密文同步更新。

5. 打开编辑器设置面板。
   预期：能看到“文章加密”模块，但看不到内部 bundle 原始字段。

6. 新建未保存正文的文章，在设置面板启用加密后点击保存。
   预期：明确失败并提示先保存正文，不能静默成功。

## 发布门槛

满足以下条件后再考虑公开发布：

- `./gradlew verifyAll` 通过
- 人工清单在目标 Halo 版本和至少一个真实主题下通过
- 升级与卸载路径都已演练
- 文档、安全边界和恢复模型描述一致
