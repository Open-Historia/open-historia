import os
import sys

src = sys.argv[1]


def patch(relative, change):
    path = os.path.join(src, relative)
    with open(path, encoding="utf-8") as handle:
        before = handle.read()
    after = change(before)
    if after != before:
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(after)
        print(f"patched {relative}")


def trap_handler(text):
    lines = text.split("\n")
    if not any(line.strip() == "#define V8_TRAP_HANDLER_SUPPORTED true" for line in lines):
        return text
    start = next(i for i, line in enumerate(lines) if line.startswith("#if V8_HOST_ARCH_X64 && V8_TARGET_ARCH_X64"))
    fallback = next(i for i, line in enumerate(lines) if i > start and line.strip() == "#define V8_TRAP_HANDLER_SUPPORTED false")
    end = next(i for i, line in enumerate(lines) if i > fallback and line.strip() == "#endif")
    lines[start:end + 1] = ["#define V8_TRAP_HANDLER_SUPPORTED false"]
    return "\n".join(lines)


def zlib_features(text):
    include_old = "#if defined(ARMV8_OS_ANDROID)\n#include <cpu-features.h>\n#elif defined(ARMV8_OS_LINUX)\n"
    include_new = "#if defined(ARMV8_OS_ANDROID) || defined(ARMV8_OS_LINUX)\n"
    probe_old = (
        "#if defined(ARMV8_OS_ANDROID) && defined(__aarch64__)\n"
        "    uint64_t features = android_getCpuFeatures();\n"
        "    arm_cpu_enable_crc32 = !!(features & ANDROID_CPU_ARM64_FEATURE_CRC32);\n"
        "    arm_cpu_enable_pmull = !!(features & ANDROID_CPU_ARM64_FEATURE_PMULL);\n"
        "#elif defined(ARMV8_OS_ANDROID) /* aarch32 */\n"
        "    uint64_t features = android_getCpuFeatures();\n"
        "    arm_cpu_enable_crc32 = !!(features & ANDROID_CPU_ARM_FEATURE_CRC32);\n"
        "    arm_cpu_enable_pmull = !!(features & ANDROID_CPU_ARM_FEATURE_PMULL);\n"
        "#elif defined(ARMV8_OS_LINUX) && defined(__aarch64__)\n"
    )
    probe_new = "#if (defined(ARMV8_OS_ANDROID) || defined(ARMV8_OS_LINUX)) && defined(__aarch64__)\n"
    if include_old in text:
        text = text.replace(include_old, include_new)
    if probe_old in text:
        text = text.replace(probe_old, probe_new)
    text = text.replace("#elif defined(ARMV8_OS_LINUX) && (defined(__ARM_NEON) || defined(__ARM_NEON__))", "#elif (defined(ARMV8_OS_ANDROID) || defined(ARMV8_OS_LINUX)) && (defined(__ARM_NEON) || defined(__ARM_NEON__))")
    return text


patch("deps/v8/src/trap-handler/trap-handler.h", trap_handler)
patch("deps/zlib/cpu_features.c", zlib_features)

with open(os.path.join(src, "deps/v8/src/trap-handler/trap-handler.h"), encoding="utf-8") as handle:
    if "#define V8_TRAP_HANDLER_SUPPORTED true" in handle.read():
        sys.exit("the trap handler patch did not apply")
with open(os.path.join(src, "deps/zlib/cpu_features.c"), encoding="utf-8") as handle:
    if "= android_getCpuFeatures();" in handle.read():
        sys.exit("the zlib CPU feature patch did not apply")
