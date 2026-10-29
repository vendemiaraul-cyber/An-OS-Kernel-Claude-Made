#!/bin/sh
# Rebuilds site/guests/linux-desktop.bzimage: Linux 6.6 with the Nano-X
# (Microwindows) desktop in a built-in initramfs. Run tools/linux/build.sh
# first (it builds musl, BusyBox and the text-mode root filesystem in
# ./build-linux); this reuses them.
#
#   sh tools/linux/build.sh && sh tools/linux/desktop/build.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${OUT:-$(cd "$HERE/../../.." && pwd)/site/guests/linux-desktop.bzimage}
W=${W:-$PWD/build-linux}
cd "$W"
M="$W/musl-i386"

# 1. Nano-X (Microwindows) with ConMon Lab's evdev mouse/keyboard input and menu.
[ -d microwindows ] || git clone -q https://github.com/ghaerr/microwindows microwindows
(cd microwindows && git checkout -q 1cfb0697b08f29b0ccab0e0775dc50f736372bd1 &&
    { git apply --reverse --check "$HERE/nanox-conmon.patch" 2>/dev/null || git apply "$HERE/nanox-conmon.patch"; })
cp "$HERE/microwindows.config" microwindows/src/config
make -k -C microwindows/src -j"$(nproc)" CC="$M/gcc32" HOSTCC=gcc || true   # a few unused demos fail to link
for b in nano-X nxstart nxterm nxclock nxtetris nxworld nxmine nxchess nxkbd nxmag nxscribble demo-nuklear-calculator demo-nuklear-overview; do
    test -f microwindows/src/bin/$b
done

# 2. Root filesystem: the text one plus the desktop.
rm -rf rootfs-desktop && cp -a rootfs rootfs-desktop
cp -r "$HERE/rootfs-src/." rootfs-desktop/
mkdir -p rootfs-desktop/usr/nanox/bin rootfs-desktop/usr/nanox/images/demos/nanox
for b in nano-X nxstart nxterm nxclock nxtetris nxworld nxmine nxchess nxkbd nxmag nxscribble demo-nuklear-calculator demo-nuklear-overview; do
    cp microwindows/src/bin/$b rootfs-desktop/usr/nanox/bin/ && strip rootfs-desktop/usr/nanox/bin/$b
done
cp microwindows/src/bin/*.cl rootfs-desktop/usr/nanox/bin/
cp microwindows/src/images/demos/nanox/nxworld.map rootfs-desktop/usr/nanox/images/demos/nanox/
chmod +x rootfs-desktop/etc/gui rootfs-desktop/etc/init.d/rcS rootfs-desktop/usr/nanox/bin/doom

# 3. Kernel: bochs DRM framebuffer, PS/2 + VMware absolute mouse, UNIX sockets.
cp "$HERE/linux-6.6-desktop.config" linux/.config
sed -i "s|^CONFIG_INITRAMFS_SOURCE=.*|CONFIG_INITRAMFS_SOURCE=\"$W/rootfs-desktop $HERE/../devnodes.txt\"|" linux/.config
make -C linux ARCH=i386 olddefconfig
make -C linux ARCH=i386 -j"$(nproc)" bzImage
cp linux/arch/x86/boot/bzImage "$OUT"
echo "Built $OUT"
