#!/bin/bash
# 跑测试只看摘要：全量输出落文件（里面有 30 万字符的单行，直接打印会把代理的上下文撑爆），屏幕上只出三行数 + 失败的名字。
#   scripts/t.sh            只跑和当前改动相关的测试（改了 app/x.js → tests/ 里提到 x 的那些 + 架构约束测试）
#   scripts/t.sh --all      全量（提交前、发版前）
#   scripts/t.sh a b        只跑 tests/a.test.js tests/b.test.js
#   scripts/t.sh --commit "提交信息"   全量，fail 0 才 git commit -a（有未跟踪文件先自己 git add）
# 退出码：fail 为 0 才是 0。09-21 出过一次「提交闸认错了摘要行的前缀，失败也放行」，所以闸写死在这里，别手写 grep。
set -u
cd "$(dirname "$0")/.." || exit 2
export PATH="/Users/aaron.wang/.local/bin:$PATH"
OUT="${THT_TEST_OUT:-.tmp/test.out}"; mkdir -p "$(dirname "$OUT")"
MODE="changed"; MSG=""; FILES=()
case "${1:-}" in
  --all) MODE="all" ;;
  --commit) MODE="commit"; MSG="${2:-}"; [ -n "$MSG" ] || { echo "要给提交信息"; exit 2; } ;;
  "") ;;
  *) MODE="named"; for n in "$@"; do FILES+=("tests/${n%.test.js}.test.js"); done ;;
esac
if [ "$MODE" = "changed" ]; then
  CHANGED=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u)
  [ -n "$CHANGED" ] || { echo "没有改动，什么都没跑（要全量用 --all）"; exit 0; }
  for f in $CHANGED; do
    case "$f" in
      tests/*.test.js) FILES+=("$f") ;;
      app/*|web/*|scripts/*) b=$(basename "$f"); b="${b%.*}"
        while IFS= read -r t; do FILES+=("$t"); done < <(grep -l -- "$b" tests/*.test.js 2>/dev/null) ;;
    esac
  done
  for t in tests/arch-*.test.js tests/contract.test.js; do [ -f "$t" ] && FILES+=("$t"); done
  [ ${#FILES[@]} -gt 0 ] || { echo "改动没对上任何测试文件，改跑全量"; MODE="all"; }
fi
node scripts/build-web.js > /dev/null 2>&1 || { echo "build-web 失败"; exit 2; }
START=$(date +%s)
if [ "$MODE" = "all" ] || [ "$MODE" = "commit" ]; then node --test tests/*.test.js > "$OUT" 2>&1
else UNIQ=$(printf '%s\n' "${FILES[@]}" | sort -u); echo "跑 $(echo "$UNIQ" | wc -l | tr -d ' ') 个测试文件"; node --test $UNIQ > "$OUT" 2>&1; fi
T=$(grep -E "^(ℹ|#) tests" "$OUT" | awk '{print $3}'); P=$(grep -E "^(ℹ|#) pass" "$OUT" | awk '{print $3}'); F=$(grep -E "^(ℹ|#) fail" "$OUT" | awk '{print $3}')
echo "tests ${T:-?} / pass ${P:-?} / fail ${F:-?} · $(( $(date +%s) - START )) 秒 · 全量输出在 $OUT"
if [ "${F:-x}" != "0" ]; then grep -nE "^\s*(✖|not ok)" "$OUT" | cut -c1-200 | head -20; exit 1; fi
if [ "$MODE" = "commit" ]; then git commit -q -a -m "$MSG

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && echo "已提交 $(git log --oneline -1 | cut -c1-80)"; fi
