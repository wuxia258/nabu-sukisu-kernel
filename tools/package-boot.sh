#!/bin/bash
# ============================================================================
# package-boot.sh —— 在 GitHub Actions 里把编译产物 Image 打包成可刷入的 boot.img
#
# 用法（在 artifact 目录下）:
#   bash package-boot.sh <上一步 artifact 解压目录> <输出目录>
#
# 需要: node（GitHub Actions ubuntu 自带 node18+）
# 依赖文件（与脚本同目录）:
#   boot_a_stock.img   —— 原始 boot 镜像（134217728 字节，用户自己备份的那个）
#   repack-boot.js     —— boot.img 重打包脚本
# ============================================================================
set -euo pipefail

ART="${1:?用法: package-boot.sh <artifact目录> <输出目录>}"
OUT="${2:-boot-out}"
HERE="$(cd "$(dirname "$0")" && pwd)"
STOCK="${STOCK_BOOT:-$HERE/boot_a_stock.img}"
REPACK="$HERE/repack-boot.js"

mkdir -p "$OUT"

if [ ! -f "$STOCK" ]; then
  echo "!! 找不到原始 boot 镜像: $STOCK"
  echo "   请把设备原始 boot_a 备份改名为 boot_a_stock.img 放到 $HERE"
  exit 1
fi
if [ ! -f "$REPACK" ]; then
  echo "!! 找不到 $REPACK"
  exit 1
fi

IMAGE="$ART/Image"
if [ ! -f "$IMAGE" ]; then
  echo "!! artifact 里没有 Image，内容如下:"
  ls -la "$ART"
  exit 1
fi

echo "=== 源文件 ==="
ls -l "$STOCK" "$IMAGE"

# 校验是 ARM64 Image
node -e '
const fs=require("fs");
const b=fs.readFileSync(process.argv[1]);
const m=b.readUInt32LE(56);
if(m!==0x644d5241){console.error("不是 ARM64 Image, offset56 = 0x"+m.toString(16));process.exit(1);}
console.log("ARM64 Image OK, size =", b.length);
' "$IMAGE"

echo ""
echo "=== 重打包 boot.img ==="
node "$REPACK" "$STOCK" "$IMAGE" "$OUT/boot.img"

echo ""
echo "=== 生成校验信息 ==="
(
  cd "$OUT"
  sha256sum boot.img > boot.img.sha256
  md5sum    boot.img > boot.img.md5
  ls -l boot.img
  cat boot.img.sha256 boot.img.md5
)

echo ""
echo "=== 完成 ==="
echo "可刷入镜像: $OUT/boot.img （134217728 字节）"
echo ""
echo "刷入命令（设备进 fastboot 后）:"
echo "  fastboot flash boot_a $OUT/boot.img"
echo "  fastboot flash boot_b $OUT/boot.img"
echo "  fastboot reboot"
