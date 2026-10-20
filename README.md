# UGCPlay 上传 CLI 与 Agent Skill

独立开源的 Node.js 22+ 工具，让 Codex、Claude Code、用户或 CI 将静态游戏上传到 UGCPlay 或兼容的自托管站点。运行时仅依赖 `fflate`，无需主站源码、Cloudflare CLI 或数据库权限。许可证为 [MIT](LICENSE)。

配套 Agent skill 会读取项目说明和实际玩法，自动补齐缺失的描述与标签，再通过 CLI 上传。用户明确提供的字段优先；无需额外模型 API Key。直接使用 CLI 时，通过 `--summary` 和 `--tags` 传入元数据，CLI 本身不调用模型。

## 让 Agent 安装 Skill

复制下面这段提示词，发给 Codex 或 Claude Code，即可让 Agent 安装 CLI 和对应的 Skill：

```text
请帮我安装 UGCPlay 上传工具：从 https://github.com/stephen-a2z/ugcplay-skill 获取仓库，在本机全局安装 ugcplay CLI，并将仓库中的 skills/ugcplay-upload 安装到当前 Agent 对应的个人 Skill 目录（Codex 用 ~/.codex/skills/，Claude Code 用 ~/.claude/skills/）。先检查 Node.js 版本是否为 22 或更高；不要覆盖已有的同名 Skill，遇到时先告诉我。安装后运行 ugcplay --help 并确认 Skill 文件存在。最后告诉我是否需要重启或重新加载 Agent。此步骤只安装工具，不要登录或上传游戏。
```

Agent 首次上传前，由用户运行 `ugcplay login` 完成浏览器授权；远程 Agent 可用 `ugcplay login --no-browser`，再由用户在自己的浏览器确认登录。

## 安装与登录

从 GitHub 获取源码并全局安装（当前 npm 包尚未发布）：

```bash
git clone https://github.com/stephen-a2z/ugcplay-skill.git
cd ugcplay-skill
npm install -g --install-links .
export UGCPLAY_SITE=https://ugcplay.dev
ugcplay login
ugcplay whoami --json
```

PowerShell 中设置站点变量的写法：

```powershell
git clone https://github.com/stephen-a2z/ugcplay-skill.git
Set-Location ugcplay-skill
npm install -g --install-links .
$env:UGCPLAY_SITE = "https://ugcplay.dev"
ugcplay login
ugcplay whoami --json
```

也可先运行 `npm ci --ignore-scripts`，再用 `node bin/ugcplay.mjs --help`。执行 `npm pack --pack-destination /tmp` 生成独立 tgz，其他用户可 `npm install -g /path/to/ugcplay-cli-0.1.0.tgz`，包中同时包含 skill。npm 包名为 `@ugcplay/cli`，命令名为 `ugcplay`，环境变量统一为 `UGCPLAY_*`。早期本地版本升级后，请使用新命令重新登录。

`login` 显示授权链接和核对码，并尝试打开浏览器。用户在浏览器通过已有 GitHub 登录，核对代码后点击确认，终端自动完成登录。远程 Agent/SSH 使用 `ugcplay login --no-browser`，用户在自己的浏览器打开链接即可；不需要把 GitHub 密码、Cookie 或 OAuth 密钥交给 Agent。登录链接 10 分钟有效，CLI 凭据 30 天有效。

任何命令可用 `--site https://your-site.example` 覆盖 `UGCPLAY_SITE`。站点必须使用 HTTPS，本地 localhost/127.0.0.1/IPv6 回环允许 HTTP。API 请求不跟随跳转。

## 上传和更新

```bash
ugcplay upload ./dist --title "我的游戏" --dry-run --json
ugcplay upload ./dist --title "我的游戏" --summary "旋转方块拼出完整图案，完成拼图挑战。" --tags "休闲,益智" --json
ugcplay upload ./game.zip --title "我的游戏" --entry index.html --cover cover.png --json
ugcplay upload ./game.html --title "单文件游戏" --json
ugcplay upload ./dist --title "我的游戏" --game-id abcd1234 --version-note "修复键盘操作" --json
ugcplay link https://trusted.example/game/ --title "外链游戏" --json
ugcplay link https://trusted.example/game.html --title "镜像作品" --mirror --json
```

`--title` 必填，长度为 1–60 个字符；`--summary` 可选，最多 500 个字符；`--tags` 接受逗号分隔的最多 3 个标签，每个最多 12 个字符，因此单个标签不能含逗号。更新时 `--version-note` 必填，最多 200 个字符；`--game-id` 是 8 位作品 ID。`--entry` 指定包内 HTML 入口；省略时优先选 `index.html`，否则仅在包内恰有一个 HTML 文件时自动选择。`--cover` 必须指向包内的 PNG/JPG/WebP/GIF 图片。

目录只应包含可发布的静态构建文件。隐藏文件和 macOS 元数据会跳过；符号链接、路径穿越、不支持的类型、重复 ZIP 路径、CRC 不匹配、加密 ZIP、ZIP64 和多卷包会拒绝。ZIP 中的路径保持原样，包裹目录里的入口可通过 `--entry game/index.html` 指定。上限与当前站点一致：200 个文件、单文件 50MB、总量 100MB；后端仍执行权限、配额、可信域名及审核规则。

`--dry-run` 在本地检查元数据、文件和入口，不需要登录，也不发起上传；外链的服务端白名单/嵌入检查在实际提交时执行。

成功时 stdout 包含 `ok`、`id`、`slug`、`shareUrl` 和服务端实际 `status`（通常 `pending`；白名单账号可能直接发布）。状态读取暂时失败时 `status` 为 `null`，提交仍成功。上传会话或完成响应缺少必填字段时会报错，不会生成无效分享链接或误报成功。`--json` 输出单行 JSON，进度和登录说明在 stderr，失败退出码为 1，带 `error`，有 HTTP 响应时还有 `status`。

文件 PUT 和最终确认最多尝试 3 次；创建上传、外链登记及游客提交不自动重试。文件上传失败会尝试取消未完成会话。最终确认结果不明时返回 `uploadId`，先检查分享页或网站的「我的作品」，不要直接重复创建。进程被强制中止留下的会话会按站点现有过期机制清理。

## 登录规则

HTML、ZIP、构建目录的正式上传和已有作品更新都必须登录。CLI 不支持 `upload --guest`；`--dry-run` 只做本地检查，仍无需登录。

URL 新作品可以直接提交，无需先登录或添加 `--guest`：

```bash
ugcplay link https://trusted.example/game --title "试玩链接" --summary "游戏玩法与目标" --tags "休闲" --json
```

已有有效的站点登录或设置了 `UGCPLAY_TOKEN` 时，URL 会归到当前账号；没有登录或本地凭据已过期时，按匿名 URL 提交。`--mirror` 同样可以免登录。URL 更新（`--game-id`）必须登录。

URL 作品更新示例（已有作品 ID 和版本说明必填）：

```bash
ugcplay link https://trusted.example/game --title "试玩链接" --game-id abcd1234 --version-note "更新关卡与操作说明" --json
```

如果已登录但服务端返回凭据失效、账号封禁或权限错误，CLI 会报告错误，不会自动改成匿名再提交。URL 仍受站点可信域名白名单与限流规则约束。

即使已登录，也可显式选择匿名 URL：

```bash
ugcplay link https://trusted.example/game --title "试玩链接" --guest --json
```

匿名 URL 返回的 `claimToken` 是日后在网站认领作品的秘密凭据，请私下保存，分享时只发 `shareUrl`。

## 凭据与登出

```bash
ugcplay tokens list --json
ugcplay tokens revoke <token-id> --json
ugcplay logout
```

凭据保存在 `${XDG_CONFIG_HOME:-~/.config}/ugcplay/` 下，每个站点独立使用 `site-<origin 的 SHA-256>.json` 文件，也可由 `UGCPLAY_CONFIG_DIR` 指定目录。独立文件原子写入，避免多个 Agent 同时登录不同站点时互相覆盖。旧版 `credentials.json` 仍兼容读取；新登录或登出以对应站点文件为准，登出标记会阻止旧凭据重新生效。目录权限为 0700，文件为 0600（Windows 按系统 ACL 管理）；不会在登录输出中显示 token。CLI 凭据仅允许上传、身份查询和 CLI 凭据管理，不能调用后台或修改账号资料。

`logout` 先撤销服务器凭据，再移除本地登录；服务器不可达时保留本地凭据，以便重试撤销。凭据已过期或撤销时会直接清理本地记录。账号封禁和原有作品归属检查照常生效。

CI 可通过秘密环境变量 `UGCPLAY_TOKEN` 提供已授权的专用凭据，并显式配置 `UGCPLAY_SITE`。凭据只发往所选站点；设置此变量时 `logout` 会提示用 `tokens revoke` 撤销，而不会误操作本地另一个登录。不要在命令行参数或日志中放 token。

## Agent Skill

仓库提供 `skills/ugcplay-upload/SKILL.md`。从仓库根目录安装到所用 Agent 的 skill 目录，例如：

```bash
mkdir -p ~/.codex/skills
cp -R skills/ugcplay-upload ~/.codex/skills/
# Claude Code 可改用 ~/.claude/skills/
```

PowerShell 可用：

```powershell
New-Item -ItemType Directory -Force "$HOME/.codex/skills" | Out-Null
Copy-Item -Recurse "skills/ugcplay-upload" "$HOME/.codex/skills/"
# Claude Code 可改用 "$HOME/.claude/skills/"
```

如果只安装了全局 npm 包，也可从包内复制 skill：

```bash
mkdir -p ~/.codex/skills
cp -R "$(npm root -g)/@ugcplay/cli/skills/ugcplay-upload" ~/.codex/skills/
```

Claude Code 使用 `~/.claude/skills/`。先安装 CLI，再将 skill 放入所用 Agent 的目录。

然后告诉 Agent：「使用 ugcplay-upload skill，把这个项目的 dist 上传到 https://ugcplay.dev，自动配好描述和标签」。首次使用由用户完成浏览器登录。

Agent 会读取 README、项目元数据、HTML 和必要的玩法代码，补齐缺失的标题、简洁描述和 1–3 个相关标签；使用用户的语言，保留用户明确指定的字段。Agent 会将相同的 `--summary` 和 `--tags` 用于 dry-run 与正式提交，已有上传授权不增加描述确认步骤。对于 ZIP 或 URL，也会依据实际内容准备元数据；只有无法了解玩法时才补充询问，不编造功能。包限制不会因为 Agent 上传而放宽。

## 自托管站点升级

服务端需兼容设备授权接口 `/api/auth/cli/*` 和现有上传接口。旧版主站先应用其自身仓库中的 `0025_cli_auth.sql` 迁移，并按主站部署流程升级主站 Worker。数据库迁移、主站和游戏 Worker 由平台项目维护，本项目仅分发客户端。

本地联调：另行启动主站项目的开发服务，先在浏览器使用「测试登录」，再运行 `ugcplay login --site http://localhost:5173`（端口以实际服务为准），授权页会复用该浏览器会话。CLI 不提供远程开发登录捷径。


## 开发与验证

```bash
npm ci --ignore-scripts
npm test
npm run test:package
```

测试使用临时本地 HTTP 服务，不访问生产站点。回归检查覆盖并发凭据保存、旧凭据兼容、上传响应校验、ZIP CRC，以及包含空格与中文的安装路径。CI 配置覆盖 Linux/Windows 与 Node.js 22/24。打包验证会生成 tgz，在仓库外的临时目录安装，检查可执行入口与 skill，并对安装后的包运行客户端测试。所有临时文件随后清理。首次安装依赖需要访问 npm registry。

CLI 的上传限制是公开协议的本地快照；服务端仍是最终校验来源。升级服务端限制时同步 `lib/policy.mjs`、元数据校验、文档与两端契约测试。

当前项目未配置远端仓库，也未发布到 npm；公开发布时需确认 `@ugcplay/cli` scope 的发布权限，再补全真实仓库地址。
