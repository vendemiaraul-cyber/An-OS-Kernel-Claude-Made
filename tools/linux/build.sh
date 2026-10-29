#!/bin/sh
# Rebuilds site/guests/linux.bzimage: Linux 6.6 (i386) with a built-in
# initramfs holding BusyBox 1.36.1 linked statically against musl 1.2.5.
# Needs: gcc (with -m32), make, flex, bison, bc, perl, xz, git.
#
#   sh tools/linux/build.sh            (works in ./build-linux)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${OUT:-$(cd "$HERE/../.." && pwd)/site/guests/linux.bzimage}
W=${W:-$PWD/build-linux}
mkdir -p "$W" && cd "$W"

[ -d linux ]   || git clone --depth 1 --branch v6.6 https://github.com/torvalds/linux linux
[ -d busybox ] || git clone --depth 1 --branch 1_36_1 https://github.com/mirror/busybox busybox
[ -d musl ]    || git clone --depth 1 --branch v1.2.5 https://github.com/kraj/musl musl   # mirror of git.musl-libc.org

# 1. Kernel headers for userland.
make -C linux ARCH=i386 headers
rm -rf khdr && mkdir khdr && (cd linux/usr && find include -name '*.h' -exec cp --parents {} "$W/khdr/" \;)

# 2. musl for i386, a tiny stand-in for 32-bit libgcc, and a gcc wrapper.
M="$W/musl-i386"
(cd musl && ./configure --target=i386-linux-musl --prefix="$M" --disable-shared CC="gcc -m32" CFLAGS=-Os \
  && make -j"$(nproc)" CROSS_COMPILE= && make install CROSS_COMPILE=)
gcc -m32 -march=i486 -Os -fno-builtin -ffreestanding -c "$HERE/mini-libgcc.c" -o mini.o && ar rcs "$M/lib/libmini.a" mini.o
sh musl/tools/musl-gcc.specs.sh "$M/include" "$M/lib" /lib/ld-musl-i386.so.1 \
  | sed -e "/^\*libgcc:/{n;s|.*|$M/lib/libmini.a|}" -e 's| crtbeginS.o%s||; s| crtbegin.o%s||; s|crtendS.o%s||; s|crtend.o%s||' > "$M/musl-gcc.specs"
cat > "$M/gcc32" <<W
#!/bin/sh
exec gcc -m32 -Wl,-m,elf_i386 -march=i486 -static -fno-stack-protector -fno-pie -no-pie -specs "$M/musl-gcc.specs" -isystem "$W/khdr/include" "\$@"
W
chmod +x "$M/gcc32"

# 3. BusyBox.
cp "$HERE/busybox-1.36.1.config" busybox/.config
make -C busybox -j"$(nproc)" CC="$M/gcc32" HOSTCC=gcc

# 4. Root filesystem: our files + busybox + one symlink per applet.
rm -rf rootfs && cp -r "$HERE/rootfs-src" rootfs && find rootfs -name .keep -delete
cp busybox/busybox rootfs/bin/busybox
(cd rootfs && for a in $(./bin/busybox --list-full); do [ "$a" = bin/busybox ] || { mkdir -p "$(dirname "$a")"; ln -sf /bin/busybox "$a"; }; done)
chmod +x rootfs/init rootfs/etc/init.d/rcS rootfs/usr/bin/doom

# 5. Kernel with the initramfs built in.
cp "$HERE/linux-6.6.config" linux/.config
sed -i "s|^CONFIG_INITRAMFS_SOURCE=.*|CONFIG_INITRAMFS_SOURCE=\"$W/rootfs $HERE/devnodes.txt\"|" linux/.config
make -C linux ARCH=i386 olddefconfig
make -C linux ARCH=i386 -j"$(nproc)" bzImage
cp linux/arch/x86/boot/bzImage "$OUT"
echo "Built $OUT"
