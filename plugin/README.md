# 奶蛙主义 · 插件手册

Web 面板提供人格、语言、皮肤和音效设置。人格与语言由宿主保存到插件目录的 `state/settings.json`，皮肤和音效偏好保存在当前浏览器。

## `/naiwa` 命令

| 输入 | 行为 | 成功文本（开头） |
|---|---|---|
| `/naiwa` 或 `/naiwa status` | 读当前状态 | `奶蛙控制：档位=…；常驻=…；语言=…；咒语=…；持久化=…。` |
| `/naiwa strength off\|naiwa\|nailoong`（或 `关闭\|奶蛙\|奶龙`） | 改档位（off 不注入人格） | `档位已设为 关闭。持久化：已写入 state/settings.json。` |
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
| `value` | string | set 时必填 | `strength=off\|naiwa\|nailoong`；`resident=on\|off`；`language=auto\|zh\|en`；`spell=任意文本`（空串清空）。 |

返回值（canonical，`output.schema` 校验）：`action`、`applied`、`strength`、`resident`、`language`、`spell`、`persisted`、`message`、`version`。非法 `field` / `action` 返回 `applied: false` 与说明，不抛错。


## 奶龙人格

在面板选择「人格 → 奶龙」，或输入 `/naiwa strength 奶龙`。从下一轮起，主对话使用奶龙口吻，重启后保留选择。角色创作参考[第七印象对奶龙和小七的介绍](https://www.nailoong.com/)，对话示例由插件原创。

## 页面桌宠

打开输入框旁的「奶蛙」面板，在「桌宠」一行选择捧腹大笑、骑车、芭蕾或蹦跳。大笑使用原视频的 438 帧，骑车、芭蕾与蹦跳使用参照原形象制作的透明动作帧。骑车和蹦跳沿页面移动，芭蕾和大笑在页面侧边播放，轻点桌宠会捧腹大笑一次，笑完回到原动作；点击会播放一段原版大笑声，并打开独立的奶蛙聊天框；面板的音效开关控制回合完成提示。按住拖动可以给它换位置，重新选择动作可恢复默认位置和移动路线。聚焦桌宠后也可按 Enter 或空格互动。默认关闭，浏览器会记住选择；系统开启减少动态效果时，桌宠静止展示。

大笑动画和点击笑声均取自 [tzshuai07/naiwa](https://github.com/tzshuai07/naiwa)，笑声截取自其桌宠音轨。[来源仓库许可](docs/naiwa-frames-LICENSE.txt)

### 和奶蛙聊天

点击桌宠，在气泡里写消息后按 Enter，Shift+Enter 换行。闲聊使用所选 Harness 会话配置的 DeepSeek 模型和凭据，成功问答按会话归档，不设轮数上限。接近模型输入预算时，使用同一模型将较早的对话增量压缩为摘要，近期问答保留原文；摘要与原文一同保存。压缩会额外调用模型，摘要可能省略细节。记忆保存在本机 Harness 数据目录的 `storages/naiwa-ism/pet-memory.sqlite`；宿主重启后打开原会话即可继续。选择「看进度」会把所选项目会话的近期文字和工具活动交给模型总结。闲聊和进度查询通过宿主鉴权的独立接口发送，回复仅显示在桌宠气泡中。升级前已有的命令记录会保留。
