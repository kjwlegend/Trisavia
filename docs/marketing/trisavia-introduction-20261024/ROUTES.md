# Intro 静态包路由

静态资源根：本目录的 `publish/`；只映射该包，不改变产品或 Agent API 路径。

| URL | 包内文件 |
| --- | --- |
| `/intro`、`/intro/` | `publish/index.html` |
| `/en/intro`、`/en/intro/` | `publish/en/index.html` |
| `/zh-CN/intro`、`/zh-CN/intro/` | `publish/zh-CN/index.html` |
| `/intro/sources.html` | `publish/sources.html` |
| `/en/intro/sources.html` | `publish/en/sources.html` |
| `/zh-CN/intro/sources.html` | `publish/zh-CN/sources.html` |
| `/intro/<共享资源相对路径>` | `publish/<共享资源相对路径>` |

共享资源为 `style.css`、`deck.js`、`content.js`、`assets/*`、`sources.md`、`sources.en.md`、`sources.zh-CN.md`；两种语言共用同一份图片。语言切换在原页面更新显示并保留 query/hash，不重定向刷新。

源码模板和资源位于本目录；`python3 build.py` 生成入口与公开包。`ROUTES.md`、`template.html`、`locales/`、`tests/` 和原本地 `sources.md` 不加入静态发布目录。
