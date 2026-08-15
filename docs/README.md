# 文章加密插件技术参考

本文档描述插件当前的数据结构、组件职责、处理流程和接口。安装与使用方法见项目根目录的 `README.md`。

## 系统要求

- Halo 版本：2.24.0 或更高版本
- 文章类型：`content.halo.run/Post`
- 正文渲染：Halo 主题渲染管线

## 内容标记

使用以下标记声明受保护的正文片段：

```markdown
[hide-password]
需要密码才能查看的内容。
[/hide-password]
```

开始标记和结束标记必须独占一行。经过 Halo 编辑器处理后，两个标记必须分别形成独立的 HTML `p` 元素。一篇文章可以包含多个受保护片段，所有片段共用该文章的访问密码。

## 密码配置

密码配置存储在文章注解 `privateposts.halo.run/hide-password` 中。注解值是由服务端生成的 JSON 字符串。

| 字段 | 类型 | 值或约束 |
| --- | --- | --- |
| `version` | integer | `1` |
| `algorithm` | string | `pbkdf2withhmacsha256` |
| `iterations` | integer | `210000` |
| `salt` | string | 16 字节随机值的十六进制编码 |
| `hash` | string | 256 位派生结果的十六进制编码 |

访问密码不能为空，最大长度为 256 个字符。服务端不返回已有密码，也不根据散列恢复密码。

## 组件

| 组件 | 职责 |
| --- | --- |
| `HidePasswordService` | 生成和校验密码配置；解析和替换受保护片段 |
| `InlinePrivatePostContentHandler` | 在主题渲染结果中将受保护片段替换为锁定块 |
| `HidePasswordConsoleRouter` | 为控制台表单生成密码配置 |
| `HidePasswordRouter` | 校验读者密码并返回受保护片段 |
| `HidePasswordPanel.vue` | 管理控制台中的密码输入和清除操作 |
| `annotation-field.ts` | 读写 FormKit 注解字段 |
| `official-save-interceptor.ts` | 在密码配置准备完成后恢复 Halo 保存提交 |
| `reader.ts` | 提交读者密码并恢复页面内容 |

## 控制台状态

密码面板使用三种状态区分未操作、更新和清除：

| 状态 | 触发条件 | 保存结果 |
| --- | --- | --- |
| `none` | 未输入新密码，也未选择清除 | 保留现有密码配置 |
| `set` | 输入新密码 | 生成并保存新的密码配置 |
| `clear` | 选择清除密码 | 删除密码配置 |

密码输入框始终为空，因为现有密码不会回显。空输入框本身不表示清除密码。

## 控制台保存流程

1. 用户在文章设置中输入新密码或选择清除密码。
2. 用户点击 Halo 的 **保存** 或 **发布**。
3. `official-save-interceptor.ts` 捕获 `post-setting-form` 的提交事件。
4. 状态为 `none` 时，插件不处理该事件。
5. 状态为 `set` 时，插件调用密码配置接口；状态为 `clear` 时，插件将注解字段置空。
6. `annotation-field.ts` 更新 FormKit hidden 字段，并派发 `input` 和 `change` 事件。
7. 插件等待 FormKit 完成状态同步，然后恢复原提交事件。
8. Halo 保存文章及其注解。

AnnotationSetting 中的密码字段使用 `delay: 0`。控制台在恢复提交前额外等待 30 毫秒，确保 FormKit 状态已经提交。

## 主题渲染流程

1. `InlinePrivatePostContentHandler` 检查文章是否包含密码配置。
2. 处理器在渲染后的 HTML 中查找成对的正文标记。
3. 处理器使用锁定块替换每个受保护片段，并为片段分配从 `0` 开始的序号。
4. 页面加载后，`reader.ts` 为锁定块绑定密码提交事件。

初始页面只包含锁定块，不包含受保护片段的 HTML。

## 读者解锁流程

1. 读者在锁定块中输入密码。
2. `reader.ts` 将文章名称和密码提交到校验接口。
3. 服务端确认文章存在、已经发布且可见性为 `PUBLIC`。
4. `HidePasswordService` 使用文章注解中的配置校验密码。
5. 校验成功后，服务端从发布版本的渲染内容中提取全部受保护片段。
6. `reader.ts` 按片段序号恢复当前文章中的全部锁定块。

## 控制台接口

`POST /apis/console.api.privateposts.halo.run/v1alpha1/hide-password/hash`

该接口要求已登录的控制台会话。

请求体：

```json
{
  "password": "new-password"
}
```

成功响应：

```json
{
  "config": "{\"version\":1,\"algorithm\":\"pbkdf2withhmacsha256\",...}",
  "message": "密码散列已生成"
}
```

| 状态码 | 含义 |
| --- | --- |
| `200` | 密码配置生成成功 |
| `400` | 请求体为空、密码为空或密码超过长度限制 |
| `403` | 控制台会话未通过身份验证 |

## 公开接口

`POST /apis/api.privateposts.halo.run/v1alpha1/hide-password/verify`

请求体：

```json
{
  "postName": "post-name",
  "password": "reader-password"
}
```

成功响应：

```json
{
  "segments": [
    "<p>受保护的 HTML 片段</p>"
  ]
}
```

| 状态码 | 含义 |
| --- | --- |
| `200` | 密码正确，返回受保护片段 |
| `400` | 请求体为空，或缺少 `postName`、`password` |
| `401` | 文章不存在、文章不可公开访问或密码错误 |

## 构建验证

在项目根目录执行完整验证：

```shell
./gradlew clean verifyAll
```

该任务执行后端测试、前端单元测试、TypeScript 类型检查、文档检查、插件构建和 JAR 内容检查。
