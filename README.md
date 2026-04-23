# Halo Private Posts（Halo 私密文章插件）

`Halo Private Posts` 是一个面向 Halo 的私密文章插件项目，目标是提供密文正文发布与浏览器本地解密阅读能力。

目标体验很简单：

1. 打开文章，先看到锁定页。
2. 输入访问密码。
3. 在浏览器中本地解密正文。
4. 离开页面、切后台或超时后自动重新锁定。

## 定位

这个项目不是另一个泛化的“限制阅读”插件。

核心区别是：

- 限制阅读更关注访问控制
- Halo Private Posts 更关注密文内容分发

预期模型是：

- 公开元数据可以继续可见
- 私密正文以密文形式存储
- 浏览器负责本地解密

## 仓库范围

这个仓库是 Halo 专属适配层。

它应该包含：

- Halo 编辑器集成
- Halo 文章字段映射
- 锁定页 UI
- 浏览器端解密流程
- 自动重锁行为
- 面向应用市场的文档和发布资产

它不应该自己重新定义私密文章核心协议。

该协议属于配套的 `ZKVault` 仓库。

## MVP

第一版只做这一条主链路：

1. 将文章标记为私密文章
2. 分别存储公开元数据和加密 bundle
3. 在文章页渲染锁定状态
4. 请求访问密码
5. 在浏览器中解密正文
6. 在路由离开、标签页隐藏或空闲超时后重锁

## 非目标

第一版不包含：

- 会员系统
- 支付流程
- 评论后解锁
- 登录后解锁
- 防复制或防截图承诺
- 多租户密钥管理

## 与 ZKVault 的关系

这个仓库是适配器，不是协议源头。

当前分工是：

- `ZKVault`：协议、作者端工具、fixture
- `halo-private-posts`：Halo 集成与发布目标

详见 [docs/ZKVAULT_INTEGRATION.md](docs/ZKVAULT_INTEGRATION.md)。

## 规划结构

- [server/README.md](server/README.md)：Halo 插件服务端集成说明
- [ui/README.md](ui/README.md)：锁定页、解锁流和重锁流
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：架构与边界
- [PRODUCT.md](PRODUCT.md)：产品定义
- [SECURITY.md](SECURITY.md)：安全边界与威胁模型

## 当前状态

当前仓库已经补齐首版产品和架构文档。

后续实现建议按这个顺序推进：

1. Halo 文章 payload 契约
2. 锁定页 UI 契约
3. 浏览器解密流程
4. 文章重锁状态流
