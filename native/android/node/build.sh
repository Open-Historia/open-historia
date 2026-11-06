set -euo pipefail
ARCH="${1:-x86_64}"
JOBS="${2:-$(nproc)}"
NODE_VERSION="${NODE_VERSION:-v24.18.0}"
export DEBIAN_FRONTEND=noninteractive
if ! command -v make >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq python3 make g++ curl unzip xz-utils patch >/dev/null
fi
cd /work
if [ ! -d /work/ndk ]; then
  curl -fsSL -o ndk.zip https://dl.google.com/android/repository/android-ndk-r29-linux.zip
  unzip -q ndk.zip && mv android-ndk-r29 ndk && rm ndk.zip
fi
if [ ! -d /work/node ]; then
  curl -fsSL -o node.tar.xz "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}.tar.xz"
  tar -xJf node.tar.xz && mv "node-${NODE_VERSION}" node && rm node.tar.xz
fi
cd /work/node
make clean >/dev/null 2>&1 || true
./android-configure patch
export CC_host=gcc CXX_host=g++ LINK_host=g++ AR_host=ar
export CFLAGS_host="-O1 -g0" CXXFLAGS_host="-O1 -g0"
start=$(date +%s)
./android-configure /work/ndk 24 "$ARCH"
make -C out BUILDTYPE=Release -j"$JOBS" node
end=$(date +%s)
case "$ARCH" in
  arm64|aarch64) ABI=arm64-v8a ;;
  *) ABI="$ARCH" ;;
esac
mkdir -p /out/"$ABI"
cp out/Release/node /out/"$ABI"/node
/work/ndk/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip -o /out/"$ABI"/node.stripped out/Release/node
echo "built node ${NODE_VERSION} for ${ABI} in $((end - start)) s"
ls -la /out/"$ABI"
