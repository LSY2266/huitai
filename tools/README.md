# tools/

## fnpack-linux-amd64

飞牛官方 `fnpack` 打包工具的 Linux x86_64 静态二进制，版本 **1.2.3**（当前官方最新）。

- 来源：<https://static2.fnnas.com/fnpack/fnpack-1.2.3-linux-amd64>
- SHA256：`54b97fa7b70968c4d05c79840f5daeff508957d0bb2062fdb0376d00d9615c93`
- 作用：CI 里把 `packaging/fnos` 打成 `.fpk`；本机 macOS 直接用 `brew`/官方 darwin 版 `fnpack` 即可。

**为什么要把它放进仓库**：官方下载站在 GitHub 海外 runner 上经常超时（同一现象在 FN-AppHub 项目里已实测过），
把二进制钉死在仓库里，发布流水线才是可复现的。`scripts/install-fnpack.sh` 会优先用这份，并在使用前校验 SHA256；
校验不通过或文件缺失时才回退到联网下载。

升级方式：替换本文件 → 同步更新上面的版本号与 SHA256 → 在 PR 里跑一次 `Release` 工作流的手动触发验证。
