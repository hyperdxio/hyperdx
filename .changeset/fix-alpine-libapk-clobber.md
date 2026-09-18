---
'@hyperdx/app': patch
---

fix: stop the all-in-one image copying node's /usr/lib over the base image

The all-in-one and local images copied the whole `/usr/lib` out of `node:22.22-alpine`, overwriting the ClickHouse base image's `libapk.so`, `libssl`, `libcrypto` and `libz`. Once the two images landed on different Alpine point releases (3.24.1 vs 3.24.2), the older `libapk.so` no longer satisfied the newer `/sbin/apk`, and every image build failed with `Error relocating /sbin/apk: apk_fs_is_malicious_filename: symbol not found`.

Node only needed `libstdc++`/`libgcc` from that copy, so those are now installed with apk from the image's own Alpine release and the blanket copy is gone. This also stops ClickHouse's OpenSSL being silently swapped for node's.
