# UGCPlay 上传 CLI 与 Agent Skill

让 Agent 把 HTML、ZIP 或静态构建目录上传到 [UGCPlay](https://ugcplay.dev)，也支持提交已有游戏 URL 和更新作品。

Agent 会根据项目内容准备标题、描述和标签，并保留用户明确指定的字段。CLI 支持浏览器登录、上传预检和 JSON 输出，适合人工操作与自动化。使用 Node.js 22+，采用 [MIT 许可证](LICENSE)。

## 快速安装

准备 Node.js **22.20+**、npm 和 Git，在终端执行两条命令：

```bash
npm install -g git+https://github.com/stephen-a2z/ugcplay-skill.git
npx skills@latest add stephen-a2z/ugcplay-skill --skill ugcplay-upload -g
```

第一条安装上传命令 `ugcplay`；第二条安装 Skill，按提示选择要使用的 Agent。`-g` 表示用户级安装，去掉它则安装到当前项目。无需手动克隆仓库或复制 Skill 目录。[Skills 安装器](https://github.com/vercel-labs/skills) 负责发现 Skill 和选择各 Agent 对应的位置；CLI 与 Skill 需要分别安装。

安装后运行 `ugcplay --help`，再按 Agent 提示重新加载或新建会话。CLI 本身支持 Node.js 22+；这里的 22.20+ 要求来自最新版 Skills 安装器。npm 包 `@ugcplay/cli` 尚未发布，上面的 CLI 命令直接从 GitHub 安装。

## 交给 Agent 安装和上传

### 1. 安装提示词

也可以把这段提示词复制给有终端和文件操作能力的 Agent：

```text
请安装 UGCPlay 上传 CLI 和 ugcplay-upload Skill：

npm install -g git+https://github.com/stephen-a2z/ugcplay-skill.git
npx skills@latest add stephen-a2z/ugcplay-skill --skill ugcplay-upload -g

先检查 Node.js 22.20+、npm 和 Git。只选择当前 Agent 作为 Skill 安装目标；根据安装器帮助使用相应的 --agent 参数，必要时使用非交互选项。已有安装先检查复用，保留用户修改。完成后确认 ugcplay --help 可运行、Skill 已放到受支持的位置，并告知是否需要新建会话。遇到权限或兼容性问题时说明原因和下一步。此次只安装，不登录或上传。
```

若安装器不支持当前 Agent，可按其官方安装方式使用仓库中的 `skills/ugcplay-upload/SKILL.md`，参考[手动安装示例](#手动安装-skill)。

### 2. 上传游戏

安装完成并按需重新加载 Agent 后，在游戏项目中发送：

```text
使用 ugcplay-upload Skill，把当前项目的 dist 目录上传到 https://ugcplay.dev。
请根据项目的实际玩法补齐缺失的标题、描述和 1–3 个标签，保留我已指定的内容。
先做 dry-run，检查通过后正式上传，最后给我分享链接和审核状态。
需要登录时，请启动浏览器授权流程并告诉我链接和核对码，由我在浏览器确认。
```

将 `dist` 换成实际构建目录、HTML、ZIP 或 HTTPS 游戏 URL；更新作品时再提供作品 ID 和版本说明。Agent 使用项目 README、HTML 和必要的玩法代码作为生成依据，无法判断玩法时会询问。元数据由 Agent 准备，无需额外模型 API Key；CLI 本身不调用模型。

**登录规则：文件上传和所有作品更新需要登录；URL 新作品可以免登录。** Agent 可启动 `ugcplay login --site <站点> --no-browser` 并等待用户确认。匿名 URL 的 `claimToken` 应私下保存，用于日后认领。

[源码安装 CLI](#源码安装-cli) · [登录](#浏览器登录) · [手动安装 Skill](#手动安装-skill) · [上传参数](#上传和更新) · [凭据与 CI](#凭据与登出) · [开发](#开发与验证)

## 源码安装 CLI

开发或需要本地修改时，可以克隆仓库安装：

```bash
git clone https://github.com/stephen-a2z/ugcplay-skill.git
cd ugcplay-skill
npm install -g --install-links .
ugcplay --help
```

也可先运行 `npm ci --ignore-scripts`，再用 `node bin/ugcplay.mjs --help`。执行 `npm pack` 可生成 `ugcplay-cli-0.1.0.tgz`，其他用户可 `npm install -g /path/to/ugcplay-cli-0.1.0.tgz`，包中同时包含 Skill。早期本地版本升级后，请使用新命令重新登录。

## 浏览器登录

无需配置环境变量即可登录指定站点：

```bash
ugcplay login --site https://ugcplay.dev
ugcplay whoami --site https://ugcplay.dev --json
```

后续命令继续使用 `--site`，或为当前终端会话配置默认站点：

```bash
# macOS / Linux
export UGCPLAY_SITE=https://ugcplay.dev
```

```powershell
# PowerShell
$env:UGCPLAY_SITE = "https://ugcplay.dev"
```

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

| 参数 | 用途与限制 |
| --- | --- |
| `--title` | 必填，1–60 个字符 |
| `--summary` | 可选，最多 500 个字符 |
| `--tags` | 可选，用英文逗号分隔，最多 3 个，每个最多 12 个字符；单个标签不能含逗号 |
| `--entry` | 文件包内的 HTML 入口；默认选根目录 `index.html`，否则只在恰有一个 HTML 时自动选择 |
| `--cover` | 文件包内的 PNG/JPG/WebP/GIF 图片路径 |
| `--game-id` | 更新已有作品，使用首次上传返回的 8 位 `id` |
| `--version-note` | 更新时必填，最多 200 个字符 |
| `--mirror` | 仅 `link`，使用站点的 HTML 镜像通道 |
| `--guest` | 仅 `link`，即使已登录也强制匿名提交 |
| `--dry-run` | 本地预检，不提交、不要求登录 |
| `--site` | 目标站点，优先于 `UGCPLAY_SITE` |
| `--json` | 单行 JSON 输出，适合 Agent 和脚本 |

字符限制按 JavaScript 字符串长度（UTF-16 单元）计算；部分 emoji 占两个单元。`--entry` 和 `--cover` 仅用于文件上传。

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

## 手动安装 Skill

仓库提供 [skills/ugcplay-upload/SKILL.md](skills/ugcplay-upload/SKILL.md)。从仓库根目录复制到当前 Agent 支持的用户级 Skill 目录。以下以 Codex 为例，其他 Agent 请使用各自文档中规定的路径：

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

Claude Code 可使用 `~/.claude/skills/`。CLI 安装与 Skill 安装是两个步骤；全局 npm 包包含 Skill 文件，但不会自动将它注册到每种 Agent。复制后按当前 Agent 的方式重新加载或新建会话。

随后使用[上传提示词](#2-上传游戏)。

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

源码已在 [GitHub](https://github.com/stephen-a2z/ugcplay-skill) 公开；npm 包尚未发布，目前可从 GitHub 直接安装，也支持源码或本地 tgz 安装。运行时仅依赖 `fflate`，无需主站源码、Cloudflare CLI 或数据库权限。问题与建议可提交到 [Issues](https://github.com/stephen-a2z/ugcplay-skill/issues)。
