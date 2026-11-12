#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-}"
OUTPUT="${2:-}"
if [ -z "$WORK" ] || [ -z "$OUTPUT" ]; then
  echo "usage: native/linux/build-imagecodec.sh <work dir> <output binary>" >&2
  exit 2
fi

DAV1D_URL="https://code.videolan.org/videolan/dav1d.git"
DAV1D_TAG="1.5.4"
DAV1D_COMMIT="54706fc6bc0cdecab7e9593974a4039cc038fca7"
LIBAVIF_URL="https://github.com/AOMediaCodec/libavif.git"
LIBAVIF_TAG="v1.4.2"
LIBAVIF_COMMIT="c5240fc79fe5c2407e10afd35f5505ef6333ea49"

mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
PREFIX="$WORK/prefix"
SOURCE="$HERE/../sidecar/imagecodec/ImageCodec.c"

fetch() {
  local url="$1" tag="$2" commit="$3" dir="$4"
  rm -rf "$dir"
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$tag" "$url" "$dir"
  local got
  got="$(git -C "$dir" rev-parse HEAD)"
  if [ "$got" != "$commit" ]; then
    echo "$url $tag is $got, wanted $commit" >&2
    exit 1
  fi
  echo "$url $tag at $got"
}

if [ ! -f "$PREFIX/lib/libdav1d.a" ] || [ ! -f "$PREFIX/.dav1d-$DAV1D_COMMIT" ]; then
  fetch "$DAV1D_URL" "$DAV1D_TAG" "$DAV1D_COMMIT" "$WORK/dav1d"
  meson setup "$WORK/dav1d/build" "$WORK/dav1d" --buildtype=release --default-library=static --prefix="$PREFIX" --libdir=lib -Denable_tools=false -Denable_tests=false -Denable_examples=false
  ninja -C "$WORK/dav1d/build" install
  touch "$PREFIX/.dav1d-$DAV1D_COMMIT"
fi

if [ ! -f "$PREFIX/lib/libavif.a" ] || [ ! -f "$PREFIX/.libavif-$LIBAVIF_COMMIT" ]; then
  fetch "$LIBAVIF_URL" "$LIBAVIF_TAG" "$LIBAVIF_COMMIT" "$WORK/libavif"
  PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" cmake -S "$WORK/libavif" -B "$WORK/libavif/build" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_PREFIX_PATH="$PREFIX" \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DCMAKE_INSTALL_LIBDIR=lib \
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
    -DBUILD_SHARED_LIBS=OFF \
    -DAVIF_CODEC_DAV1D=SYSTEM \
    -DAVIF_LIBYUV=OFF \
    -DAVIF_LIBSHARPYUV=OFF \
    -DAVIF_BUILD_APPS=OFF \
    -DAVIF_BUILD_TESTS=OFF \
    -DAVIF_ENABLE_WERROR=OFF
  cmake --build "$WORK/libavif/build"
  cmake --install "$WORK/libavif/build"
  touch "$PREFIX/.libavif-$LIBAVIF_COMMIT"
fi

mkdir -p "$(dirname "$OUTPUT")"
cc -O2 -D_GNU_SOURCE -Wall -Wextra -Wno-unused-parameter -I"$PREFIX/include" "$SOURCE" -o "$OUTPUT" \
  "$PREFIX/lib/libavif.a" "$PREFIX/lib/libdav1d.a" \
  -Wl,-Bstatic -lz -Wl,-Bdynamic -lpthread -lm -ldl -static-libgcc
strip "$OUTPUT"
echo "built $OUTPUT ($(wc -c < "$OUTPUT") bytes) with libavif $LIBAVIF_TAG and dav1d $DAV1D_TAG"
ldd "$OUTPUT" || true
objdump -T "$OUTPUT" | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1 | sed 's/^/needs at most /'
