# 奶蛙主义 · 插件手册

Web 面板提供人格、语言、皮肤和音效设置。人格与语言由宿主保存到插件目录的 `state/settings.json`，皮肤和音效偏好保存在当前浏览器。

## `/naiwa` 命令

| 输入 | 行为 | 成功文本（开头） |
|---|---|---|
| `/naiwa` 或 `/naiwa status` | 读当前状态 | `奶蛙控制：档位=…；常驻=…；语言=…；咒语=…；持久化=…。` |
| `/naiwa strength off\|naiwa`（或 `关闭\|奶蛙`） | 改档位（off 不注入人格） | `档位已设为 关闭。持久化：已写入 state/settings.json。` |
| `/naiwa resident on\|off`（或 `开\|关`） | 常驻开关 | `常驻已开启。` / `常驻已关闭。` |
| `/naiwa language auto\|zh\|en`（或 `中文\|英文`） | 回答语言 | `语言已设为 English。` |
| `/naiwa spell <文本>`（空 = 清空，>120 截断） | 自定义咒语 | `咒语已更新。` / `咒语已清空。` |
| `/naiwa reset` | 回落 config 默认并删状态文件 | `已重置为 config 默认：档位=…。状态文件已删除。` |
| 非法参数 / 未知子命令 | 不改状态 | `参数不合法：…。语法：/naiwa …` |

## `naiwa_config` 工具

与 `/naiwa` 共用 `applyOperation`、同一状态、同一文案来源。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `action` | string | 是 | `get`（读状态）/ `set`（改一个字段）。 |
| `field` | string | set 时必填 | `strength` / `resident` / `language` / `spell`。 |
| `value` | string | set 时必填 | `strength=off\|naiwa`；`resident=on\|off`；`language=auto\|zh\|en`；`spell=任意文本`（空串清空）。 |

返回值（canonical，`output.schema` 校验）：`action`、`applied`、`strength`、`resident`、`language`、`spell`、`persisted`、`message`、`version`。非法 `field` / `action` 返回 `applied: false` 与说明，不抛错。

