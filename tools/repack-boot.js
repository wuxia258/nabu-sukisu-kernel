// repack-boot.js — 用新内核替换 Android boot.img 里的 kernel，保持 header_version=3 布局
//
// 小米平板5 (nabu) 的 boot.img 布局（已实测确认）:
//   [0     , 4096)       header (header_size=1580, header_version=3)
//   [4096  , +kernel_size)  kernel  —— RAW ARM64 Image（非 gzip！）
//   ramdisk 起点 = 4096 + ceil(kernel_size/4096)*4096   —— gzip
//   [content_end, +896)  vbmeta blob (AVB0)
//   [134217664, 134217728) AVB footer (AVBf)，partition 总长 134217728
//
// 用法:
//   node repack-boot.js <原始boot.img> <新内核Image> <输出boot.img>

const fs = require('fs');

const PAGE = 4096;
const BOOT_PART_SIZE = 134217728;

function align(v, a = PAGE) { return Math.ceil(v / a) * a; }

function main() {
  const [origPath, imagePath, outPath] = process.argv.slice(2);
  if (!origPath || !imagePath || !outPath) {
    console.error('用法: node repack-boot.js <原始boot.img> <新内核Image> <输出boot.img>');
    process.exit(2);
  }

  const orig = fs.readFileSync(origPath);
  const newImage = fs.readFileSync(imagePath);

  // ---- 校验原始 boot.img ----
  if (orig.toString('ascii', 0, 8) !== 'ANDROID!') throw new Error('原始文件不是 ANDROID! boot image');
  const origKernelSize = orig.readUInt32LE(8);
  const origRamdiskSize = orig.readUInt32LE(12);
  const headerSize = orig.readUInt32LE(20);
  const headerVersion = orig.readUInt32LE(40);
  if (headerVersion !== 3) throw new Error('只支持 header_version=3，实际 ' + headerVersion);

  // ---- 校验新内核是 ARM64 Image ----
  const magic = newImage.readUInt32LE(56);
  if (magic !== 0x644d5241) {
    throw new Error('新内核不是 ARM64 Image（offset 56 魔数应为 0x644d5241，实际 0x' +
      magic.toString(16) + '）');
  }
  const textOffset = newImage.readBigUInt64LE(8);
  const imageSize = newImage.readBigUInt64LE(16);

  // ---- 取出原始各段 ----
  const header = Buffer.from(orig.slice(0, headerSize));
  const origKernelOff = PAGE;
  const origRamdiskOff = origKernelOff + align(origKernelSize);
  const ramdisk = Buffer.from(orig.slice(origRamdiskOff, origRamdiskOff + origRamdiskSize));

  // AVB: 内容结束点（原始）= ramdisk 页对齐末尾
  const origContentEnd = align(origRamdiskOff + origRamdiskSize);

  // 从尾部 footer 读 vbmeta 位置/大小（以 footer 为准更可靠）
  const footerOff = BOOT_PART_SIZE - 64;
  let vbmetaBlob = null;
  if (orig.toString('ascii', footerOff, footerOff + 4) === 'AVBf') {
    const vbmetaOff = Number(orig.readBigUInt64BE(footerOff + 20));
    const vbmetaSize = Number(orig.readBigUInt64BE(footerOff + 28));
    if (orig.toString('ascii', vbmetaOff, vbmetaOff + 4) === 'AVB0') {
      vbmetaBlob = Buffer.from(orig.slice(vbmetaOff, vbmetaOff + vbmetaSize));
    }
  }
  if (!vbmetaBlob) {
    // 退化：假设紧跟内容之后
    if (orig.toString('ascii', origContentEnd, origContentEnd + 4) === 'AVB0') {
      vbmetaBlob = Buffer.from(orig.slice(origContentEnd, origContentEnd + 896));
    }
  }

  // ---- 组装 ----
  const newKernel = Buffer.alloc(align(newImage.length), 0);
  newImage.copy(newKernel);

  const newKernelSize = newImage.length;          // header 里记录真实长度（不含对齐填充）
  const newRamdiskSize = ramdisk.length;          // 不变
  const newRamdiskOff = PAGE + newKernel.length;

  const out = Buffer.alloc(BOOT_PART_SIZE, 0);
  // 1. header
  header.copy(out, 0);
  out.writeUInt32LE(newKernelSize, 8);
  out.writeUInt32LE(newRamdiskSize, 12);
  // 2. kernel
  newKernel.copy(out, PAGE);
  // 3. ramdisk
  ramdisk.copy(out, newRamdiskOff);
  // 4. vbmeta + footer
  const newContentEnd = align(newRamdiskOff + newRamdiskSize);
  const vbmetaOff = newContentEnd;
  if (vbmetaBlob) {
    vbmetaBlob.copy(out, vbmetaOff);
  }
  // footer
  const footer = Buffer.alloc(64, 0);
  footer.write('AVBf', 0, 'ascii');
  footer.writeUInt32BE(1, 4);                       // version_major
  footer.writeUInt32BE(0, 8);                       // version_minor
  footer.writeBigUInt64BE(BigInt(newContentEnd), 12);            // original_image_size
  footer.writeBigUInt64BE(BigInt(vbmetaOff), 20);                // vbmeta_offset
  footer.writeBigUInt64BE(BigInt(vbmetaBlob ? vbmetaBlob.length : 0), 28); // vbmeta_size
  footer.copy(out, footerOff);

  fs.writeFileSync(outPath, out);

  console.log('=== repack 完成 ===');
  console.log('原始 kernel_size   =', origKernelSize);
  console.log('新  kernel_size   =', newKernelSize);
  console.log('原始 ramdisk_size =', origRamdiskSize, ' @', origRamdiskOff);
  console.log('新  ramdisk_size =', newRamdiskSize, ' @', newRamdiskOff);
  console.log('新  内容结束      =', newContentEnd);
  console.log('vbmeta @', vbmetaOff, 'size =', vbmetaBlob ? vbmetaBlob.length : 0);
  console.log('AVB footer @', footerOff);
  console.log('输出文件 =', outPath, ' 大小 =', out.length);
  console.log('ARM64 Image: text_offset=0x' + textOffset.toString(16) +
              ' image_size=0x' + imageSize.toString(16));
}

main();
