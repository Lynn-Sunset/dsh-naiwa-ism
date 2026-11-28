# 奶蛙主义 · Naiwa-ism

简体中文 · [English](./README.en.md)

一个给 DeepSeek Harness 会话加上奶蛙口吻的插件。它提供叙事、美术提示词和语言节奏三个工具，也可以在 Web 面板里切换人格、语言、皮肤与回合结束提示音。

<img src="./assets/naiwa.png" alt="奶蛙桌宠从抱着肚子站立到仰头大笑的三个画面" width="720">

预览图来自 [tzshuai07 的奶蛙桌宠](https://github.com/tzshuai07/naiwa/blob/main/docs/preview.png)，随图附上[上游 MIT 许可证](./assets/naiwa-LICENSE.txt)。

## 宿主版本

适配 DeepSeek Harness 默认渠道 `0.2.2-rc.5` 和预览渠道 `0.2.3-alpha.2`。使用 npm 或源码运行 alpha 版时，宿主要求 Node.js `^24.22.3 || >=26.13.1`；桌面版自带运行时。

## 安装

1. 下载并解压此仓库，或运行 `git clone https://github.com/Lynn-Sunset/dsh-naiwa-ism.git`。
2. 在 DeepSeek Harness 的插件管理器中执行 `install_bundle`，目标填本机 **plugin 子目录的绝对路径**。例如，仓库位于 Windows 的 `D:/Projects/dsh-naiwa-ism` 时，参数如下。

   ```json
   {"action": "install_bundle", "target": "D:/Projects/dsh-naiwa-ism/plugin"}
   ```

3. 如果插件管理器返回 `restart-required`，先重启 Harness。刷新 Harness Web 页面，在会话中输入 `/naiwa status` 检查当前配置。

## 使用

| 操作 | 用途 |
| --- | --- |
| `/naiwa strength naiwa` | 启用奶蛙人格 |
| `/naiwa strength 奶龙` | 切换为好奇、爱吃的奶龙人格 |
| `/naiwa strength off` | 关闭人格，保留工具 |
| `/naiwa language zh` | 将回答语言设为中文 |
| `naiwa_gloss` | 提供五拍写作指引和独立的语感示例，由模型据此写作 |
| `naiwa_art` | 生成配色、美术指导和中英绘图提示词 |
| `naiwa_speak` | 提供逐句节奏计划和示例，标记需要保留的代码与网址 |

在「奶蛙」面板开启桌宠，可选择骑车、芭蕾、蹦跳或捧腹大笑。轻点桌宠，它会笑出声并打开聊天气泡。闲聊和「看进度」使用当前会话的 DeepSeek 模型，需要连接模型服务。聊天记录按会话保存在本机，重启 Harness 后可以继续。

「看进度」会列出近期命令、状态和关键输出，展开后可读对应的会话日志原文。刷新后可以翻看更早的消息和图片，追问默认沿用本会话最近一张图，也可以点旧图旁的「引用这张图」。桌面端可从框内拖动，触屏上滑动翻阅、长按后拖动；消息和代码块可单独复制。

奶蛙读记录、查网页和逐段回复时会显示对应状态。桌宠动作、背景插画和回合完成提示音均可离线使用。完整命令和配置见[插件手册](plugin/README.md)。

主聊天或桌宠聊天正常回复后，奶蛙会屈膝、蹬地、抱膝腾空，再缓冲落地，随后接回选中的动作。「看进度」的回复完成时也会触发。庆祝跳跃遵循系统的「减少动态效果」设置。

## 验证

从仓库根目录使用 Node.js 24 运行 `node --test tests/*.test.mjs`。插件没有运行时 npm 依赖。

## 许可

插件原创代码允许非商业使用、修改和分发。商业使用须事先取得相关权利人的书面授权。第三方素材按各自的许可条款使用。[完整许可证](./LICENSE)
