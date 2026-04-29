# Smoke Test

本文档定义 `halo-private-posts` 发布前的最低回归清单。

## 自动化入口

先执行：

```bash
./gradlew smokeCheck
```

它会：

- 跑完整 `build`
- 验证插件 JAR 已产出
- 验证包内包含 `plugin.yaml`、console 资源和 reader 资源

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

其中 `smokeCheck` 会先跑完整 `build`；而 `build` 又会包含 `check`，所以前端 `typeCheckUi` 和 `testUi` 也已经被间接覆盖。

如果脚本提示 `build mount is stale`，说明当前 Halo 开发容器已经不适合继续热重载。默认行为是直接停止并给出修复命令；只有在你明确接受重建容器时，才使用：

```bash
RECREATE_CONTAINER_ON_STALE_MOUNT=1 ./scripts/dev-container-smoke.sh
```

如果要验证后台登录、插件 Console 页面，以及一次真实的平台恢复口令重置，再执行：

```bash
./gradlew installPlaywrightUi
./gradlew testE2eUi
```

如果想把开发容器 smoke、前端回归和后台恢复 e2e 一次跑完，直接使用：

```bash
./scripts/dev-container-acceptance.sh
```

它会串起：

- `./scripts/dev-container-smoke.sh`
- `./gradlew testE2eUi`

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
   预期：文章设置里出现“私密正文”工具，后台能进入 `/console/private-posts`。

2. 新建一篇公开文章并保存正文。
   预期：未加锁时原文章页仍是普通正文。

3. 在文章设置里输入访问口令并点击“根据当前正文加锁”。
   预期：设置成功，文章列表状态更新，原文章页切为锁定态。

4. 在原文章页输入错误口令。
   预期：解锁失败，页面不泄露正文。

5. 在原文章页输入正确口令。
   预期：正文在浏览器内解锁，刷新或切后台后会重新锁定。

6. 打开独立阅读页 `/private-posts?slug=...`。
   预期：可以使用同一访问口令解锁，接口响应不被缓存。

7. 打开后台 `/console/private-posts`，用平台恢复重置访问口令。
   预期：旧口令失效，新口令立即生效。

8. 返回文章设置，点击“取消加锁”。
   预期：原文章页恢复普通正文，`PrivatePost` 镜像被清理。

9. 如本次演练包含卸载，再删除插件。
   预期：日志显示卸载清理完成；若失败，按 [OPERATIONS.md](OPERATIONS.md) 的人工恢复步骤处理。

## 发布门槛

满足以下条件后再考虑公开发布：

- `./gradlew smokeCheck` 通过
- 人工清单在目标 Halo 版本和至少一个真实主题下通过
- 升级与卸载路径都已演练
- 文档、安全边界和恢复模型描述一致
