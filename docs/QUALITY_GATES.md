# 质量门槛

本文档定义不同改动的最低检查项。更高风险的改动可以加测，但不能低于这里的要求。

## 固定入口

### `./gradlew verifyDocs`

- 校验必须存在的规范文档、`docs/README.md` 核心索引，以及根 `README.md` 到文档索引的入口。
- 目标：根 `README.md` 保持简洁，技术文档集中由 `docs/README.md` 承载。

### `./gradlew quickCheck`

- 仓库级快速检查。
- 当前覆盖：
  - Java 单元测试
  - 前端单元测试
  - 前端类型检查
  - 文档存在性和文档索引校验

### `./gradlew smokeCheck`

- 在 `quickCheck` 基础上继续构建完整插件包。
- 额外校验 JAR 内必须包含 `plugin.yaml`、console 资源和 reader 资源。

### `./gradlew verifyAll`

- 当前统一的 CI / 发版前入口。
- 等价于文档校验、快速测试和打包 smoke 校验。

### `./scripts/dev-container-acceptance.sh`

- 面向真实 Halo 开发容器的验收入口。
- 覆盖容器 smoke、前端 e2e 和卸载演练。

## 改动类型与最低检查

### 1. 仅文档改动

- 必跑：`./gradlew verifyDocs`

### 2. 前端 UI 或交互改动

- 必跑：`./gradlew quickCheck`
- 如果涉及编辑页、设置面板或列表状态入口：
  - 额外执行 `docs/SMOKE_TEST.md` 中的保存回归矩阵

### 3. 服务端接口、同步、恢复链路改动

- 必跑：`./gradlew smokeCheck`
- 如果涉及保存、bundle、恢复密钥、正文同步：
  - 额外执行 `docs/SMOKE_TEST.md` 中的保存回归矩阵

### 4. 保存链路或加密行为改动

- 必跑：`./gradlew smokeCheck`
- 必须补自动化回归测试，至少落在最接近 bug 的一层
- 必须更新 `docs/SAVE_ENCRYPTION_CONTRACT.md`
- 必须执行 `docs/SMOKE_TEST.md` 的保存回归矩阵

### 5. 发版、标签、交付 JAR

- 必跑：`./gradlew verifyAll`
- 建议再跑：`./scripts/dev-container-acceptance.sh`

## 测试补充规则

1. 每个 bug 修复至少补一条自动化回归测试。
2. 回归测试优先写在最接近 bug 的层：
   - 纯解析或分支判断：前端 / 后端单元测试
   - 路由与服务端 fallback：服务端测试
   - 多入口 UI 联动：e2e 或人工回归矩阵
3. 如果 bug 涉及多个保存入口，测试必须覆盖每个入口，不能只测其中一条。
4. 如果暂时无法自动化，必须把人工回归项写入 `docs/SMOKE_TEST.md`。

## 通过标准

1. 所有必须执行的入口都通过。
2. 文档中的命令、任务名、文件路径与仓库实际一致。
3. 新增规范文档已经进入 `docs/README.md` 索引。
4. 修改行为契约时，对应契约文档已同步更新。
