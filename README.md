# SukiSU 内核编译包 — 小米平板5 (nabu)

为 **小米平板5 (nabu)** 编译一个内置 **SukiSU** 的内核，让 `com.sukisu.nova` 管理器能识别并正常工作。

> **先看 [操作步骤.md](操作步骤.md)** —— 那是手把手步骤。本文件是技术细节备查。

## 当前设备状态（编译基线）

| 项 | 值 |
|---|---|
| 运行内核 | `4.14.180-o-gc9058e293`（c15 内核，AnyKernel3 刷入） |
| boot 备份基线 | `tools/boot_a_stock.img`，md5 `ab75765e3e65bd4ed7826161a34fd1fe` |
| 当前 root 方案 | **APatch 0.13.9 (11282) - Full**，`su` 正常工作 |
| SukiSU Nova | v3.0.0 (35000)，显示「未安装」+ 预览模式提示 |

## 为什么需要自己编译

设备当前内核 `4.14.180-uotan-ge6025c29a` 里**已经有**一份很老的 KernelSU（execve/input/vfs_read 三 hook + `prctl(0xDEADBEEF)`，156 条 `KernelSU:` 串），
所以 KernelSU 官方管理器 v0.9.5 能正常工作（`su -c id` 返回 root）。

但 SukiSU Nova v3.0.0 要求内核提供 **UAPI 协商接口**（`getKernelUAPIVersion`）。老内核没有，所以管理器只能进入"预览模式"：
> 未检测到 SukiSU 内核。当前已有 root 权限，页面以预览模式打开；内核相关功能不会生效。

**唯一的解决办法是重新编译内核，把 SukiSU 编进去。** 没有捷径（LKM 模式不适用于 4.14 non-GKI）。

## 已验证的技术前提

| 项目 | 状态 |
|---|---|
| 内核源码 | 小米官方 `MiCode/Xiaomi_Kernel_OpenSource` 分支 **`nabu-r-oss`**，`VERSION=4 PATCHLEVEL=14 SUBLEVEL=180` **与设备完全一致** |
| 配置一致性 | 设备 `/proc/config.gz` 与源码 `nabu_user_defconfig` 仅 **22 项差异**（IPA3/HZ_100/RNDIS_IPA 等无关项）→ 同一源码血缘 |
| SukiSU 分支 | **`builtin`** 分支的 `Kconfig` 里 `config KSU` **无 `depends on KPROBES`** → 适配本内核（`CONFIG_KPROBES is not set`） |
| hook 函数签名 | 已逐字核对 `ksu_handle_{faccessat,execveat,stat,vfs_read,sys_reboot,input_handle_event}` 的真实签名，与补丁一致 |
| 补丁可应用性 | `patch -p1 --dry-run` **6 个文件全部通过**，真实 apply 后与预期文件**逐字节相同** |
| boot.img 布局 | 已 100% 实测确认（header_version=3、kernel 是 RAW ARM64 Image、ramdisk gzip、尾部 AVB footer） |
| repack 脚本 | **往返验证 0 字节差异**；基线 `boot_a_stock.img` 已更新为**设备当前 c15 内核**（md5 `ab75765e...`），往返同样 0 差异 |
| 配置基线 | `config/nabu_device_defconfig` 从设备**当前** `/proc/config.gz` 重新导出，与旧版（uotan 内核）**逐项 0 差异** → c15 与 uotan 内核 config 完全相同 |
| 驱动丢失风险 | 已排除：设备 `/proc/modules` **0 行**，`/vendor/lib/modules` 里 34 个 `.ko` 的 vermagic 与运行内核**不同源**、一个都没加载；关键驱动（cs35l41/kgsl/adsp/msm_drm/camera）全部 **built-in** |

## 目录结构

```
.
├── .github/workflows/build-kernel.yml   # GitHub Actions 编译流程
├── config/nabu_device_defconfig          # 设备真实 config（从 /proc/config.gz 导出，6163 行）
├── patches/ksu-hooks.patch               # 6 处手动 hook（145 行）
├── tools/repack-boot.js                  # boot.img 重打包（Node，跨平台）
├── tools/package-boot.sh                 # 打包封装脚本
├── tools/boot_a_stock.img                # 当前内核原始 boot（134217728 B, md5 ab75765e...）
└── 操作步骤.md                            # ★ 手把手操作步骤，先看这个
```

## 使用方法

### 1. 建一个 GitHub 仓库并上传这些文件

```bash
cd D:/666/sukisu-build
git init
git add -A
git commit -m "SukiSU kernel build for nabu"
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

> **注意**：`tools/boot_a_stock.img` 有 128 MB，GitHub 单文件限制 100 MB，**不要提交它**。
> 在本机打包 boot.img 时才需要它（见第 3 步），它会留在本地。

### 2. 跑 workflow

GitHub 网页 → 你的仓库 → **Actions** → 左侧选 **Build SukiSU Kernel for nabu (4.14.180)** → **Run workflow**

参数：
- `sukisu_ref`: `builtin`（**不要改**，这是 4.14 non-GKI 专用分支）
- `enable_kpm`: `false`（KPM 需要额外配置，先用 false 保证能开机）
- `enable_susfs`: `false`（**必须 false**！SUSFS 需要额外集成 `fs/susfs.c`，本内核没有，开了必然编译失败）

约 40–60 分钟。失败的话下载 `build-log-failure` artifact 看日志。

### 3. 下载 artifact 并打包 boot.img（在本机做）

```bash
# 解压下载的 sukisu-nabu-kernel.zip 到某个目录，例如 D:/666/artifact
cd D:/666/sukisu-build/tools
bash package-boot.sh D:/666/artifact D:/666/boot-out
```

会生成 `D:/666/boot-out/boot.img`（134217728 字节）+ sha256/md5。

### 4. 刷入设备

```bash
export PATH="/d/UotanToolbox_Windows_x64_3.7.2/UotanToolbox_Windows_x64_3.7.2/Bin/platform-tools:$PATH"
adb reboot bootloader
fastboot flash boot_a /d/666/boot-out/boot.img
fastboot flash boot_b /d/666/boot-out/boot.img
fastboot reboot
```

开机后打开 SukiSU Nova，应该显示"已安装"而不是"未安装"。

### 5. 如果开不了机（回滚）

```bash
fastboot flash boot_a /d/666/backup/boot_a_orig_134M.bin
fastboot flash boot_b /d/666/backup/boot_b_orig_134M.bin
fastboot reboot
```

或直接 `fastboot boot` 一份 TWRP（`D:\666\tools\V4-MODDED-TWRP-WINDOWS-15_10_2026.img`）再刷回去。

## 关键技术细节

### 补丁 6 处 hook（patches/ksu-hooks.patch）

| 文件 | 函数 | 插入的调用 |
|---|---|---|
| `fs/open.c` | `SYSCALL_DEFINE3(faccessat,...)` | `ksu_handle_faccessat(&dfd, &filename, &mode, NULL);` |
| `fs/exec.c` | `do_execveat_common(...)` | `ksu_handle_execveat(&fd, &filename, &argv, &envp, &flags);` |
| `fs/stat.c` | `vfs_statx(...)` | `ksu_handle_stat(&dfd, &filename, &flags);` |
| `fs/read_write.c` | `vfs_read(...)` | `ksu_handle_vfs_read(&file, &buf, &count, &pos);` |
| `kernel/reboot.c` | `SYSCALL_DEFINE4(reboot,...)` | `ksu_handle_sys_reboot(magic1, magic2, cmd, &arg);` |
| `drivers/input/input.c` | `input_handle_event(...)` | `ksu_handle_input_handle_event(&type, &code, &value);` |

**所有调用都放在函数内所有变量声明之后**（gnu89 兼容，避免 `-Wdeclaration-after-statement`）。
每处调用外层都套 `#ifdef CONFIG_KSU` / `#endif`。

### 为什么必须关 SUSFS

`SukiSU-Nova/builtin/kernel/Kconfig` 里：
```
config KSU_SUSFS
    bool "KernelSU addon - SUSFS"
    depends on KSU
    depends on THREAD_INFO_IN_TASK
    default y            # ← 关键
```
本设备 `CONFIG_THREAD_INFO_IN_TASK=y`，所以 `olddefconfig` 会**自动打开** `CONFIG_KSU_SUSFS`。

但：
1. SUSFS 需要外部 `fs/susfs.c`（来自 `gitlab.com/simonpunk/susfs4ksu`），本内核**没有集成** → 链接失败
2. 更致命：`feature/sucompat.h` 里 `#ifdef CONFIG_KSU_SUSFS` 分支会把 `ksu_handle_faccessat` / `ksu_handle_stat` 的签名从
   `(const char __user **)` 改成 `(struct filename **)`，`ksu_handle_execveat` 改名为 `ksu_handle_execveat_sucompat` → 与我们补丁不匹配

所以 workflow 里显式写 `# CONFIG_KSU_SUSFS is not set`。

### boot.img 重打包原理

```
[0     , 4096)            header (header_size=1580, header_version=3)
[4096  , +kernel_size)    kernel —— RAW ARM64 Image（不是 gzip！magic@56 = 0x644d5241）
[ramdisk_off, +ramdisk)   ramdisk —— gzip（magic 1f8b0800）
[content_end, +896)       vbmeta blob (AVB0)
[134217664, 134217728)    AVB footer (AVBf)
```
`repack-boot.js` 只替换 kernel 段，保留原 ramdisk / vbmeta / header，重写 AVB footer 的 `original_image_size` 与 `vbmeta_offset`。
输出固定 134217728 字节。

## 这个包里已经帮你踩掉的坑

如果自己从零写 workflow，下面几处**一定会踩**，我都已经修好了：

| 坑 | 症状 | 这个包里的处理 |
|---|---|---|
| `main` 分支的 `setup.sh` 从第三方私有服务器克隆 | GHA 上 `git clone` 超时/连接失败 | 改用 **`builtin` 分支**的 `setup.sh`，它指向官方 `github.com/SukiSU-Nova/SukiSU-Nova` |
| `proton-clang` 没有 `20210208` 这个 tag | `curl` 404 | 改用 **`20210123`**（Clang 12.0.0 的最后一个 tag；`20210130` 起升到 13） |
| `CONFIG_KSU_SUSFS` 是 `default y` 且依赖 `THREAD_INFO_IN_TASK` | `olddefconfig` 自动打开 SUSFS，需要 `fs/susfs.c` → 链接失败；且会改变 hook 函数签名 | 显式写 `# CONFIG_KSU_SUSFS is not set`，并在 build 前断言 |
| 误检出 `main` 分支时 `CONFIG_KSU` 会因 `depends on KPROBES` 被**静默丢弃** | 编译"成功"但产物里没 KSU | Integrate 步骤里 `grep "depends on KPROBES"` 就 `exit 1`；Configure 步骤里断言 `CONFIG_KSU=y` 存活 |
| hook 调用插在变量声明之前 | 4.14 的 gnu89 + `-Wdeclaration-after-statement` 报错 | 补丁里 6 处调用全部在函数内所有声明之后 |
| boot.img 的 kernel 段是 **RAW ARM64 Image**，不是 gzip | 误当 gzip 解压会得到垃圾 | `repack-boot.js` 按 offset 56 的 `0x644d5241` 校验 |

## 已排除的风险

- **modversions 符号 CRC 不匹配丢驱动**：不会。`/proc/modules` 是空的，34 个 `.ko` 从没被加载过（vermagic `4.14.180-perf-g98d7380da` ≠ 运行内核 `4.14.180-uotan-ge6025c29a`）。驱动都是 built-in。
- **4.14 开 kprobes 死锁**：不会。workflow 显式 `# CONFIG_KPROBES is not set`，SukiSU builtin 分支不需要 kprobes。
- **vbmeta / AVB 校验**：设备 `ro.boot.verifiedbootstate=orange`（已解锁），且 boot.img 尾部 vbmeta blob 原样保留，不做改动。

## 排错

**编译失败**：下载 `build-log-failure`，看 `kernel/build.log`。常见原因：
- `drivers/kernelsu` 不存在 → `setup.sh` 没有正确 checkout `builtin` 分支
- `ksu_handle_*` 未定义 → 补丁没打上，或 SUSFS 被打开导致签名变了
- `fs/susfs.c` 找不到 → `CONFIG_KSU_SUSFS` 没关

**能编译但开机黑屏**：
- 先确认 `strings Image | grep -c KernelSU` 有输出（说明编进去了）
- 检查 `config.txt` 里 `CONFIG_KSU_SUSFS` 是否为 `is not set`
- 用 TWRP 的 `dmesg | grep -i ksu` 看有没有 KSU 启动日志
- 回滚到 `boot_a_orig_134M.bin`

**开机成功但管理器仍显示未安装**：
- 确认装的 SukiSU Nova 版本 ≥ v3.0.0
- `adb shell "su -c id"` 看 su 是否工作
- `adb shell "cat /proc/kallsyms | grep ksu"` 看符号是否在内核里
