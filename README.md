# 奶蛙主义 · Naiwa-ism

一个给 DeepSeek Harness 会话加上奶蛙口吻的插件。它提供叙事、美术提示词和语言节奏三个工具，也可以在 Web 面板里切换人格、语言、皮肤与回合结束提示音。

![奶蛙的两种表情](plugin/docs/preview.svg)

## 安装

1. 下载并解压此仓库，或运行 `git clone https://github.com/Lynn-Sunset/dsh-naiwa-ism.git`。
2. 在 DeepSeek Harness 的插件管理器中执行 `install_bundle`，目标填本机 **plugin 子目录的绝对路径**。例如，仓库位于 Windows 的 `D:/Projects/dsh-naiwa-ism` 时，参数如下。

   ```json
   {"action": "install_bundle", "target": "D:/Projects/dsh-naiwa-ism/plugin"}
   ```

3. 刷新 Harness Web 页面，在会话中输入 `/naiwa status` 检查当前配置。

## 使用

| 操作 | 用途 |
| --- | --- |
| `/naiwa strength naiwa` | 启用奶蛙人格 |
| `/naiwa strength off` | 关闭人格，保留工具 |
| `/naiwa language zh` | 将回答语言设为中文 |
| `naiwa_gloss` | 把主题拆成五拍叙事 |
| `naiwa_art` | 生成配色、美术指导和中英绘图提示词 |
| `naiwa_speak` | 调整句读和尾音，保留代码与网址 |

完整命令和配置工具参数见[插件手册](plugin/README.md)。公开版自带双表情插画和四段合成提示音，运行时可离线使用。

## 验证

从仓库根目录使用 Node.js 24 运行 `node --test tests/*.test.mjs`。插件没有运行时 npm 依赖。
