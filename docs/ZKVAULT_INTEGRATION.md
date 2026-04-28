# 协议边界说明

## 目标

`halo-private-posts` 负责 Halo 侧的适配、存储和浏览器交互，不负责把运行时依赖绑到某个外部桌面应用或 CLI 上。

## 当前协议事实

当前仓库只写入和读取 `EncryptedPrivatePostBundle v3`。

### `v3` 当前结构

- 随机生成内容密钥 `CEK`
- 正文用 `AES-256-GCM` 加密
- `password_slot` 用 `scrypt + AES-GCM` 包裹 `CEK`
- `site_recovery_slot` 用站点恢复公钥包裹同一个 `CEK`

当前前端只接受：

- `version = 3`
- `payload_format = markdown | html`
- `cipher = aes-256-gcm`
- `kdf = envelope`
- `password_slot.kdf = scrypt`

其中：

- `markdown` 会在阅读端渲染为 HTML
- `html` 会在阅读端按当前白名单规则做净化后再渲染

## 私钥与密码边界

当前实现明确遵守以下边界：

- Halo 不保存访问密码
- Halo 服务端保存站点恢复私钥
- 前端只获取站点恢复公钥
- 正文公开阅读仍然只能靠访问口令

## 版本约束

- 新文章按 `v3` 生成
- 阅读端按 `v3` 解锁
- 后台平台恢复只针对 `site_recovery_slot`
- 如需继续演进协议，应通过显式版本升级完成

## 当前集成策略

当前仓库把协议实现边界拆成两部分：

- 浏览器端负责加锁、密码解锁和正文渲染
- 服务端负责平台恢复密钥管理与后台口令重置

当前产品 UI 约束是：

- 阅读端公开界面只暴露访问密码输入
- 平台恢复不向浏览器暴露恢复私钥或 `CEK`

服务端的职责是：

- 保存注解和扩展资源
- 提供匿名 bundle 读取入口
- 给主题和 reader 提供稳定视图模型
- 保存站点恢复密钥并执行后台重置口令
