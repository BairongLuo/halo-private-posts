# 部署与运维

本文档面向站点管理员，描述 `halo-private-posts` 在 Halo 站点中的安装、升级、卸载和回滚注意事项。

## 适用范围

- Halo `2.24.x`
- 插件协议：`EncryptedPrivatePostBundle v3`
- 恢复模型：`password_slot + site_recovery_slot + 服务端站点恢复私钥`

## 上线前准备

- 先在与生产接近的 Halo `2.24.x` 环境执行一次完整回归。
- 确认站点启用了 HTTPS；访问密码和后台恢复操作都不应在明文链路上传输。
- 确认 Halo 备份范围包含插件生成的站点恢复 Secret：`halo-private-posts-site-recovery`。
- 收紧 Halo 后台权限。拥有后台恢复权限的一方可以重置已加锁文章的访问口令。
- 不要给 `/private-posts` 或 `/private-posts/data` 额外加 CDN 缓存；插件本身会返回 `Cache-Control: no-store`。

## 安装

1. 备份 Halo 数据目录和数据库。
2. 准备插件包 `build/libs/halo-private-posts-<version>.jar`。
3. 在 Halo 后台安装并启用插件。
4. 启用后确认以下入口可见：
   - 文章设置中的“私密正文”工具
   - 后台 `/console/private-posts`
   - 前台 `/private-posts?slug=...`
5. 首次使用平台恢复能力时，插件会在服务端创建 Secret `halo-private-posts-site-recovery`。这个 Secret 是平台恢复根能力的一部分，必须纳入备份和访问控制。

## 升级

1. 升级前先备份 Halo 数据和 `halo-private-posts-site-recovery`。
2. 只在支持 `v3` bundle 的版本之间升级或回滚。
3. 替换插件包后，至少完成一次发布前 smoke test：
   - `./gradlew smokeCheck`
   - 安装 -> 加锁 -> 阅读 -> 平台恢复重置口令 -> 取消加锁
4. 升级完成后抽查一篇历史已加锁文章：
   - 后台列表仍能看到映射
   - 原文章页仍显示锁定态
   - 新口令重置后旧口令失效

## 发版资产

- 本地手工打包时，使用 `./gradlew smokeCheck`，确认 `build/libs/halo-private-posts-<version>.jar` 已产出。
- GitHub Actions 已提供 `.github/workflows/release.yml`：
  - 手动触发时会构建插件 JAR 并上传 artifact
  - 推送 `v*` tag 时会额外生成 `SHA256SUMS` 并创建 GitHub Release
- 建议只在 `./scripts/dev-container-acceptance.sh` 已通过后再执行正式发版。

## 回滚

- 不要回滚到旧的 `v2 / 助记词恢复` 时代版本。当前仓库只保证 `v3`。
- 如果新版本有问题，优先回滚到仍支持 `v3 + site_recovery_slot` 的版本。
- 回滚前不要删除 `halo-private-posts-site-recovery`，否则后台平台恢复会失效。
- 如果只是想暂时停止使用插件，优先保留插件并取消文章加锁，而不是直接删除插件。

## 停用与卸载

需要区分三件事：

- 停用插件：停止功能，但不自动清理文章注解和镜像。
- 升级插件：保留现有文章和恢复 Secret。
- 删除插件：插件会在卸载时尝试移除文章注解并删除 `PrivatePost` 镜像。

正常卸载时，插件会：

- 清理 `Post.metadata.annotations["privateposts.halo.run/bundle"]`
- 删除 `PrivatePost` 扩展资源镜像

卸载完成后，建议人工复核：

- 原文章页不再显示锁定态
- `/apis/privateposts.halo.run/v1alpha1/privateposts` 不再残留相关资源
- 日志中没有 `Completed uninstall cleanup ... with failures`

## 卸载失败时的人工恢复

如果日志中出现卸载失败或残留资源，按下面顺序处理：

1. 记录失败日志中的 `postName` 和 `PrivatePost` 资源名。
2. 手动移除对应文章的注解 `privateposts.halo.run/bundle`。
3. 手动删除残留的 `PrivatePost` 资源，资源名默认等于 `postName`。
4. 重新访问原文章页，确认正文恢复为普通文章渲染。
5. 确认站点上已经没有需要平台恢复的文章后，再决定是否手动删除 Secret `halo-private-posts-site-recovery`。

## 日常运维建议

- 定期抽查一篇已加锁文章的“错误口令 -> 正确口令 -> 自动重锁”流程。
- 对平台恢复操作保留后台审计和最小权限控制。
- 备份恢复演练时，务必验证 `halo-private-posts-site-recovery` 随站点一起恢复。
