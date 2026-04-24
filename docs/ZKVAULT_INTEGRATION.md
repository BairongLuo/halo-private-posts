# ZKVault 集成说明

## 目标

`halo-private-posts` 应通过共享协议与 `ZKVault` 集成，而不是通过运行时耦合原生应用来集成。

## 共享契约

当前预期的共享契约是 `ZKVault` 仓库中定义的私密文章加密 bundle。

这个仓库应将 `ZKVault` 视为以下内容的事实来源：

- bundle 结构
- bundle 版本规则
- 示例数据样本
- 作者端加密输出预期

当前实现直接消费 `EncryptedPrivatePostBundle v1`，并把解密兼容性测试固定在仓库内的 fixture 上。

## 共享示例数据

推荐的同步模型是：

- `ZKVault` 为每个支持的 bundle 版本提供 fixture 样本
- 本仓库使用这些 fixture 做兼容性测试

典型 fixture 内容包括：

- 明文文章样本
- 加密 bundle 样本
- 版本说明

当前已同步样本：

- [fixtures/private-post/v1/reference-hello/document.json](../fixtures/private-post/v1/reference-hello/document.json)
- [fixtures/private-post/v1/reference-hello/bundle.json](../fixtures/private-post/v1/reference-hello/bundle.json)

## 版本管理

这个仓库应明确声明自己支持哪些 bundle 版本。

例如：

- 支持 `EncryptedPrivatePostBundle` 版本 `1`

如果 `ZKVault` 中的协议发生变化，这里的兼容性应显式更新，而不是默认假设继续兼容。

当前前端实现只接受：

- `version = 1`
- `payload_format = markdown`
- `cipher = aes-256-gcm`
- `kdf = scrypt`

如果协议字段或解密流程变化，应先在 `ZKVault` 升级版本，再由本仓库按版本补支持。

## 不该做什么

- 不要让 Halo 读者运行时依赖本地 `zkvault` 二进制
- 不要把 CLI 文本输出当成正式集成契约
- 不要复制协议定义并演变成 Halo 私有的一次性格式

## 当前实现策略

- 服务端只保存 bundle 和公开元数据，不保存访问密码
- Console 页的“本地解锁测试”在浏览器内执行，不把密码发送到 Halo
- 阅读页通过匿名 JSON 端点获取 bundle，再在浏览器内解密

## 后续演进

如果浏览器端解密路径未来需要在 Halo 和其他 Web 平台之间复用，可以再单独抽一个共享前端包。

在此之前，这个仓库应继续保持 Halo 适配层角色，而 `ZKVault` 继续保持协议源头角色。
