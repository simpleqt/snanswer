#!/bin/bash
# Publish a release from the maintainer's machine.
#
# Usage:
#   1. bump "version" in package.json, commit & push
#   2. npx electron-vite build && npx electron-builder --win --x64 && npx electron-builder --mac
#   3. git tag -a vX.Y.Z && git push origin vX.Y.Z
#   4. ./scripts/publish-release.sh [release-notes-markdown-file]
#
# Guarantees the exe and latest.yml uploaded to the release come from the
# SAME local build, then re-verifies the remote release (exe size vs the
# size declared in latest.yml) — the mismatch described in issue #2 (CI
# overwrote latest.yml with a differently-hashed build) can never ship
# silently again. CI is build-verification only (EP_PUBLISH=never).
set -euo pipefail

REPO="simpleqt/snanswer"
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
EXE="dist/snanswer-$VERSION-setup.exe"
DMG="dist/snanswer-$VERSION.dmg"
YML="dist/latest.yml"

for f in "$EXE" "$DMG" "$YML"; do
  [ -f "$f" ] || { echo "缺少 $f，请先完成本地双平台打包"; exit 1; }
done

TOKEN=$(printf "protocol=https\nhost=github.com\n" | GIT_TERMINAL_PROMPT=0 git credential fill 2>/dev/null | awk -F= '/^password/{print $2}')
[ -n "$TOKEN" ] || { echo "钥匙串中没有 GitHub 凭据"; exit 1; }
AUTH="Authorization: Bearer $TOKEN"

# 本地一致性：latest.yml 必须与本地 exe 同一次构建产出
YML_SIZE=$(grep -m1 '  size:' "$YML" | tr -dc '0-9')
EXE_SIZE=$(stat -f%z "$EXE" 2>/dev/null || stat -c%s "$EXE")
if [ "$YML_SIZE" != "$EXE_SIZE" ]; then
  echo "本地 latest.yml(size=$YML_SIZE) 与本地 exe(size=$EXE_SIZE) 不一致，请重新打包"
  exit 1
fi

# 创建或复用 Release
RID=$(curl -sS -H "$AUTH" "https://api.github.com/repos/$REPO/releases/tags/$TAG" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('id') or '')")
if [ -z "$RID" ]; then
  RID=$(curl -sS -X POST -H "$AUTH" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$REPO/releases" \
    -d "{\"tag_name\": \"$TAG\", \"name\": \"$TAG\"}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id') or '')")
  [ -n "$RID" ] || { echo "创建 Release 失败"; exit 1; }
  echo "已创建 Release $TAG (id=$RID)"
else
  echo "复用已有 Release $TAG (id=$RID)"
fi

upload() { # $1=文件 $2=资产名
  local aid
  aid=$(curl -sS -H "$AUTH" "https://api.github.com/repos/$REPO/releases/$RID/assets" | python3 -c "
import sys, json
for a in json.load(sys.stdin):
    if a['name'] == '$2':
        print(a['id'])
")
  [ -n "$aid" ] && curl -sS -X DELETE -H "$AUTH" "https://api.github.com/repos/$REPO/releases/assets/$aid" -o /dev/null
  curl -sS -X POST -H "$AUTH" -H "Content-Type: application/octet-stream" \
    --data-binary "@$1" \
    "https://uploads.github.com/repos/$REPO/releases/$RID/assets?name=$2" |
    python3 -c "import sys,json;print('  $2 =>', json.load(sys.stdin).get('state','ERR'))"
}

echo "上传附件…"
upload "$EXE" "$(basename "$EXE")"
upload "$DMG" "$(basename "$DMG")"
upload "$YML" "latest.yml"

# 可选：把 Release 描述设置为发行说明文件内容（$1）
if [ -n "${1:-}" ] && [ -f "$1" ]; then
  # JSON 转义用本地 python3（不联网），上传走 curl（用系统证书，
  # python.org 版 python3 的 urllib 常因缺 CA 证书握手失败）
  python3 -c 'import json,sys; sys.stdout.write(json.dumps({"body": open(sys.argv[1], encoding="utf-8").read()}))' "$1" > /tmp/snanswer-release-body.json &&
    curl -sS -X PATCH -H "$AUTH" -H "Accept: application/vnd.github+json" \
      -H "Content-Type: application/json" \
      "https://api.github.com/repos/$REPO/releases/$RID" \
      --data-binary @/tmp/snanswer-release-body.json -o /dev/null &&
    echo "Release 描述已更新" ||
    echo "警告：更新 Release 描述失败，请手动补全"
fi

# 发布后自检：远端 latest.yml 的 size 必须等于远端 exe 实际大小
echo "校验远端一致性…"
sleep 5
curl -sSL "https://github.com/$REPO/releases/download/$TAG/latest.yml" > /tmp/verify-latest.yml
REMOTE_YML_SIZE=$(grep -m1 '  size:' /tmp/verify-latest.yml | tr -dc '0-9')
REMOTE_EXE_SIZE=$(curl -sSLI "https://github.com/$REPO/releases/download/$TAG/$(basename "$EXE")" |
  awk 'tolower($1)=="content-length:"{gsub(/\r/,""); s=$2} END{print s}')
if [ -z "$REMOTE_EXE_SIZE" ] || [ "$REMOTE_YML_SIZE" != "$REMOTE_EXE_SIZE" ]; then
  echo "❌ 远端校验失败：latest.yml 声明 $REMOTE_YML_SIZE，exe 实际 $REMOTE_EXE_SIZE"
  exit 1
fi
echo "✅ 远端一致（exe $REMOTE_EXE_SIZE 字节），自动更新校验将通过"
echo "完成：https://github.com/$REPO/releases/tag/${TAG}（记得补全 Release 描述）"
