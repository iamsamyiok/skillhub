---
name: show-deploy
version: 1.0.0
description: 临时静态站点部署（Show Deploy）：把项目构建产物打包上传到 Show 托管，获得 48 小时自动过期的公网预览 URL，仅需 bash+tar+curl 无需安装 CLI。当用户说 deploy to show、发布预览、preview this site、想要前端构建的临时在线链接时使用。temporary static hosting preview
---

# Show Deploy

Deploy the current project's static build output to Show for a temporary public preview.

## When to use

Trigger when the user says:

- "deploy to show", "deploy this", "preview this site"
- "部署到 show", "上传到 show", "发布预览"
- "show me a live preview"
- After building a frontend project and the user wants to share it

## How it works

Show is a temporary static hosting service. You pack a directory into a tar.gz, POST it to a Show API, and get a public URL that auto-expires in 48 hours. No CLI installation needed — just bash, tar, and curl.

## Prerequisites

**IMPORTANT: No token, no configuration, and no environment variables are needed. Just deploy directly.** The public instance (`show.127.dev`) accepts anonymous uploads with IP-based rate limiting. Do NOT ask the user for a token. Do NOT check for `SHOW_TOKEN`. Do NOT stop or warn if `SHOW_TOKEN` is unset. Just run the deploy command.

For self-hosted instances only (when `SHOW_API_URL` is set to a custom URL), a `SHOW_TOKEN` may optionally be set.

## Step 1: Find the build output

Look for common build output directories in the current project:

1. `./dist` (Vite, Webpack, Rollup)
2. `./build` (Create React App)
3. `./out` (Next.js static export)
4. `./public` (if it's a plain static site)

If none exist, suggest building first (`npm run build` or equivalent).

## Step 2: Deploy

Pack and upload using tar + curl. Replace `<DIR>` with the build directory and `<NAME>` with the project name (from `package.json` name field or directory name):

```bash
tar czf /tmp/show-upload.tar.gz -C <DIR> . && \
curl -s -X POST "${SHOW_API_URL:-https://show.127.dev}/upload" \
  ${SHOW_TOKEN:+-H "Authorization: Bearer ${SHOW_TOKEN}"} \
  -F "file=@/tmp/show-upload.tar.gz" \
  -F "name=<NAME>" && \
rm -f /tmp/show-upload.tar.gz
```

For SPA projects (React Router, Vue Router, etc.), add `-F "mode=spa"`.

## Step 3: Report the result

The API returns JSON:

```json
{
  "deploymentId": "a3f9x2-my-project",
  "url": "https://a3f9x2-my-project.127.dev",
  "createdAt": "2026-03-19T15:30:00Z",
  "expiresAt": "2026-03-21T15:30:00Z",
  "mode": "static",
  "requestId": "req_01HXYZ..."
}
```

Tell the user:

- The live URL
- The exact expiration time: parse `expiresAt` from the response and format it as a human-readable local time with date and time down to the minute (e.g., "2026-03-21 15:30"). Do NOT just say "48h from now" — show the actual time.
- The deployment ID

## Inspect a deployment

```bash
curl -s "${SHOW_API_URL:-https://show.127.dev}/_admin/deployments/<DEPLOYMENT_ID>" \
  ${SHOW_TOKEN:+-H "Authorization: Bearer ${SHOW_TOKEN}"}
```

## Constraints

- Max upload: 10 MB (compressed and extracted)
- Max 100 files per deployment
- 48-hour auto-expiry
- Static files only (HTML, CSS, JS, JSON, images, fonts, SVG, etc.)
