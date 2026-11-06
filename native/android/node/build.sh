set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCH="${1:-x86_64}"
JOBS="${2:-$(nproc)}"
NODE_VERSION="${NODE_VERSION:-v24.18.0}"
NDK_VERSION="${NDK_VERSION:-r29}"
ANDROID_API="${ANDROID_API:-24}"
WORK="${WORK:-/work}"
OUT="${OUT:-/out}"
case "$ARCH" in
  arm64|aarch64|arm64-v8a) ARCH=arm64; ABI=arm64-v8a ;;
  x86_64|x64) ARCH=x86_64; ABI=x86_64 ;;
  *) echo "unknown arch $ARCH (use arm64 or x86_64)" >&2; exit 2 ;;
esac
export DEBIAN_FRONTEND=noninteractive
if ! command -v make >/dev/null || ! command -v python3 >/dev/null || ! command -v g++-12 >/dev/null || ! command -v curl >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq python3 make g++ gcc-12 g++-12 curl unzip xz-utils >/dev/null
fi
mkdir -p "$WORK" "$OUT/$ABI"
NDK="$WORK/ndk-$NDK_VERSION"
if [ ! -x "$NDK/ndk-build" ]; then
  if [ -x "$WORK/ndk/ndk-build" ] && grep -q "Pkg.Revision = ${NDK_VERSION#r}" "$WORK/ndk/source.properties"; then
    ln -sfn "$WORK/ndk" "$NDK"
  else
    rm -rf "$NDK" "$WORK/ndk-download"
    mkdir -p "$WORK/ndk-download"
    curl -fsSL -o "$WORK/ndk-download/ndk.zip" "https://dl.google.com/android/repository/android-ndk-${NDK_VERSION}-linux.zip"
    unzip -q "$WORK/ndk-download/ndk.zip" -d "$WORK/ndk-download"
    mv "$WORK/ndk-download/android-ndk-${NDK_VERSION}" "$NDK"
    rm -rf "$WORK/ndk-download"
  fi
fi
TARBALL="$WORK/node-${NODE_VERSION}.tar.xz"
if [ ! -f "$TARBALL" ]; then
  curl -fsSL -o "$TARBALL.part" "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}.tar.xz"
  mv "$TARBALL.part" "$TARBALL"
fi
SRC="$WORK/build/${NODE_VERSION}-${ABI}"
if [ ! -f "$SRC/.oh-configured" ]; then
  rm -rf "$SRC"
  mkdir -p "$SRC"
  tar -xJf "$TARBALL" -C "$SRC" --strip-components=1
  python3 "$HERE/patch_node.py" "$SRC"
  cd "$SRC"
  export CC_host=gcc-12 CXX_host=g++-12 LINK_host=g++-12 AR_host=ar
  export CFLAGS_host="-O1 -g0" CXXFLAGS_host="-O1 -g0"
  ./android-configure "$NDK" "$ANDROID_API" "$ARCH"
  test -f "$SRC/config.gypi"
  touch "$SRC/.oh-configured"
fi
python3 "$HERE/patch_node.py" "$SRC"
cd "$SRC"
export CC_host=gcc-12 CXX_host=g++-12 LINK_host=g++-12 AR_host=ar
export CFLAGS_host="-O1 -g0" CXXFLAGS_host="-O1 -g0"
start=$(date +%s)
make -C out BUILDTYPE=Release -j"$JOBS" node
end=$(date +%s)
"$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip" -o "$OUT/$ABI/node.stripped" out/Release/node
printf '%s\n' "$NODE_VERSION" > "$OUT/$ABI/VERSION"
echo "built node ${NODE_VERSION} for ${ABI} in $((end - start)) s"
ls -la "$OUT/$ABI"
