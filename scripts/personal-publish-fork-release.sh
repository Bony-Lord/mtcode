#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${T3_PERSONAL_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
RELEASE_REPO="${T3_PERSONAL_RELEASE_REPO:-Bony-Lord/mtcode}"
REMOTE="${T3_PERSONAL_REMOTE:-personal}"
VERSION="${T3_PERSONAL_RELEASE_VERSION:-}"
ARTIFACT_DIR="${T3_PERSONAL_ARTIFACT_DIR:-$REPO_ROOT/release}"
NOTES_FILE="${T3_PERSONAL_RELEASE_NOTES:-$REPO_ROOT/RELEASE_NOTES_$VERSION.md}"
MODE="${1:---check}"

fail() {
  echo "$*" >&2
  exit 2
}

[[ $# -le 1 && ( "$MODE" == --check || "$MODE" == --publish ) ]] ||
  fail "Usage: $0 [--check|--publish]"
if [[ -z "$VERSION" || ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  fail "Set T3_PERSONAL_RELEASE_VERSION to an explicit semver such as 0.1.70."
fi
cd "$REPO_ROOT"
[[ "$RELEASE_REPO" == Bony-Lord/mtcode ]] || fail "Use the personal fork Bony-Lord/mtcode."
for remote_url in "$(git remote get-url --all "$REMOTE")" "$(git remote get-url --push --all "$REMOTE")"; do
  case "${remote_url%.git}" in
    "https://github.com/$RELEASE_REPO"|"git@github.com:$RELEASE_REPO"|"ssh://git@github.com/$RELEASE_REPO") ;;
    *) fail "Remote '$REMOTE' must point only to $RELEASE_REPO for fetch and push." ;;
  esac
done

EXE="$ARTIFACT_DIR/MT-Code-$VERSION-x64.exe"
BLOCKMAP="$EXE.blockmap"
FEED="$ARTIFACT_DIR/latest.yml"
for file in "$EXE" "$BLOCKMAP" "$FEED" "$NOTES_FILE"; do
  [[ -f "$file" && -s "$file" ]] || fail "Missing or empty release file: $file"
done

node --input-type=module - "$VERSION" "$EXE" "$FEED" <<'JS'
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { parseUpdateManifest } from "./scripts/lib/update-manifest.ts";

const [version, installer, feed] = process.argv.slice(2);
const raw = readFileSync(feed, "utf8");
const manifest = parseUpdateManifest(raw, feed, "Windows");
const file = manifest.files[0];
const hash = createHash("sha512");
for await (const chunk of createReadStream(installer)) hash.update(chunk);
const digest = hash.digest("base64");
if (
  manifest.version !== version ||
  manifest.files.length !== 1 ||
  file?.url !== basename(installer) ||
  file.size !== statSync(installer).size ||
  file.sha512 !== digest ||
  raw.match(/^path:\s*(.+)$/m)?.[1]?.trim() !== file.url ||
  raw.match(/^sha512:\s*(.+)$/m)?.[1]?.trim() !== digest
) {
  throw new Error("latest.yml does not match the Windows installer or requested version.");
}
JS

CHECKSUMS="$ARTIFACT_DIR/SHA256SUMS.txt"
(
  cd "$ARTIFACT_DIR"
  sha256sum "$(basename "$EXE")" "$(basename "$BLOCKMAP")" "$(basename "$FEED")" > "$(basename "$CHECKSUMS")"
)
echo "Verified the local Windows installer and update manifest for $VERSION."
[[ "$MODE" == --publish ]] || exit 0

[[ -z "$(git status --porcelain)" ]] || fail "Refusing to publish with a dirty worktree."
TAG="v$VERSION"
if git show-ref --verify --quiet "refs/tags/$TAG"; then
  fail "Local tag $TAG already exists."
fi
if git ls-remote --exit-code --tags "$REMOTE" "refs/tags/$TAG" >/dev/null; then
  fail "Remote tag $TAG already exists."
else
  [[ $? -eq 2 ]] || fail "Could not check tags on $REMOTE."
fi
case "$(gh repo view "$RELEASE_REPO" --json viewerPermission --jq .viewerPermission)" in
  ADMIN|MAINTAIN|WRITE) ;;
  *) fail "GitHub access must allow releases in $RELEASE_REPO." ;;
esac
git tag -a "$TAG" -m "MT Code $VERSION"
GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c 'credential.helper=!gh auth git-credential' \
  push "$REMOTE" "refs/tags/$TAG"
gh release create "$TAG" "$EXE" "$BLOCKMAP" "$FEED" "$CHECKSUMS" \
  --repo "$RELEASE_REPO" --verify-tag --draft --title "MT Code $VERSION" --notes-file "$NOTES_FILE"

uploaded="$(gh release view "$TAG" --repo "$RELEASE_REPO" --json assets --jq '.assets[] | [.name, .digest] | @tsv')"
for file in "$EXE" "$BLOCKMAP" "$FEED" "$CHECKSUMS"; do
  read -r sum _ < <(sha256sum "$file")
  expected="$(basename "$file")"$'\t'"sha256:$sum"
  grep -Fxq -- "$expected" <<<"$uploaded" ||
    fail "Digest verification failed for $(basename "$file"). Release $TAG is still a draft."
done
gh release edit "$TAG" --repo "$RELEASE_REPO" --draft=false --latest
echo "Published https://github.com/$RELEASE_REPO/releases/tag/$TAG"
echo "Feed https://github.com/$RELEASE_REPO/releases/download/$TAG/latest.yml"
