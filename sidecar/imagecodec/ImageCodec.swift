import CoreGraphics
import Foundation
import ImageIO

let maxFrames = 256
let pixelBudget = 24_000_000

struct CodecFailure: Error {
	let message: String
}

func say(_ text: String) {
	FileHandle.standardOutput.write(Data((text + "\n").utf8))
}

func clean(_ text: String) -> String {
	return text.replacingOccurrences(of: "\t", with: " ").replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
}

func isAvif(_ data: Data) -> Bool {
	let bytes = [UInt8](data.prefix(256))
	if bytes.count < 16 || String(bytes: bytes[4..<8], encoding: .ascii) != "ftyp" {
		return false
	}
	let size = Int(bytes[0]) << 24 | Int(bytes[1]) << 16 | Int(bytes[2]) << 8 | Int(bytes[3])
	let end = min(bytes.count, size >= 16 ? size : 16, 256)
	var at = 8
	while at + 4 <= end {
		if at != 12 {
			let brand = String(bytes: bytes[at..<(at + 4)], encoding: .ascii)
			if brand == "avif" || brand == "avis" {
				return true
			}
		}
		at += 4
	}
	return false
}

func number(_ value: Any?) -> Double? {
	if let value = value as? NSNumber {
		return value.doubleValue
	}
	return nil
}

func findValue(_ properties: [String: Any], _ keys: [String]) -> Double? {
	for key in keys {
		if let value = number(properties[key]) {
			return value
		}
	}
	for (_, nested) in properties {
		if let nested = nested as? [String: Any] {
			for key in keys {
				if let value = number(nested[key]), value > 0 || key == "LoopCount" {
					return value
				}
			}
		}
	}
	return nil
}

func seconds(_ value: Double) -> String {
	var text = String(format: "%.6f", value)
	while text.hasSuffix("0") {
		text.removeLast()
	}
	if text.hasSuffix(".") {
		text.removeLast()
	}
	return text
}

func hasAlpha(_ image: CGImage) -> Bool {
	switch image.alphaInfo {
	case .none, .noneSkipFirst, .noneSkipLast:
		return false
	default:
		return true
	}
}

func flatten(_ image: CGImage, _ width: Int, _ height: Int) throws -> CGImage {
	guard let space = CGColorSpace(name: CGColorSpace.sRGB),
		let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
	else {
		throw CodecFailure(message: "The picture could not be prepared.")
	}
	let rect = CGRect(x: 0, y: 0, width: width, height: height)
	context.clear(rect)
	context.interpolationQuality = .high
	context.draw(image, in: rect)
	guard let flat = context.makeImage() else {
		throw CodecFailure(message: "The picture could not be prepared.")
	}
	return flat
}

func writePng(_ image: CGImage, _ target: String) throws {
	let partial = target + ".part"
	let manager = FileManager.default
	try manager.createDirectory(atPath: (target as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
	do {
		guard let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: partial) as CFURL, "public.png" as CFString, 1, nil) else {
			throw CodecFailure(message: "The PNG file could not be created.")
		}
		CGImageDestinationAddImage(destination, image, nil)
		if !CGImageDestinationFinalize(destination) {
			throw CodecFailure(message: "The PNG file could not be written.")
		}
		if manager.fileExists(atPath: target) {
			try manager.removeItem(atPath: target)
		}
		try manager.moveItem(atPath: partial, toPath: target)
	} catch {
		try? manager.removeItem(atPath: partial)
		throw error
	}
}

func framePath(_ target: String, _ index: Int) -> String {
	let stem = target.lowercased().hasSuffix(".png") ? String(target.dropLast(4)) : target
	return stem + "." + String(index) + ".png"
}

func pixelSize(_ source: CGImageSource, _ index: Int) -> (Int, Int) {
	let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [String: Any] ?? [:]
	let width = Int(number(properties[kCGImagePropertyPixelWidth as String]) ?? 0)
	let height = Int(number(properties[kCGImagePropertyPixelHeight as String]) ?? 0)
	return (width, height)
}

func convertSequence(_ source: CGImageSource, _ count: Int, _ target: String) throws -> String {
	guard let first = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
		throw CodecFailure(message: "The picture sequence has no pictures in it.")
	}
	let width = first.width
	let height = first.height
	if width <= 0 || height <= 0 {
		return "failed\tThe picture sequence has no size."
	}
	let budget = max(1, min(maxFrames, pixelBudget / max(1, width * height)))
	let limit = min(budget, count)
	var timings: [String] = []
	var alpha = "none"
	for index in 0..<limit {
		guard let frame = index == 0 ? first : CGImageSourceCreateImageAtIndex(source, index, nil) else {
			if index == 0 {
				throw CodecFailure(message: "The picture sequence has no pictures in it.")
			}
			break
		}
		if hasAlpha(frame) {
			alpha = "track"
		}
		try writePng(try flatten(frame, width, height), index == 0 ? target : framePath(target, index))
		let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [String: Any] ?? [:]
		let delay = findValue(properties, ["UnclampedDelayTime", "DelayTime"]) ?? 0.1
		timings.append(seconds(delay <= 0.010 ? 0.1 : delay))
	}
	let container = CGImageSourceCopyProperties(source, nil) as? [String: Any] ?? [:]
	let repeats = findValue(container, ["LoopCount"])
	let loops = repeats == nil || repeats! <= 0 ? -1 : Int(repeats!)
	return "ok\t\(width)\t\(height)\t\(alpha)\t\(timings.count)\t\(loops)\t" + timings.joined(separator: ",")
}

func convertStill(_ source: CGImageSource, _ target: String) throws -> String {
	let (storedWidth, storedHeight) = pixelSize(source, 0)
	var image: CGImage? = nil
	if storedWidth > 0 && storedHeight > 0 {
		let options: [CFString: Any] = [
			kCGImageSourceCreateThumbnailFromImageAlways: true,
			kCGImageSourceCreateThumbnailWithTransform: true,
			kCGImageSourceThumbnailMaxPixelSize: max(storedWidth, storedHeight),
			kCGImageSourceShouldCacheImmediately: true,
		]
		image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
	}
	if image == nil {
		image = CGImageSourceCreateImageAtIndex(source, 0, nil)
	}
	guard let picture = image else {
		throw CodecFailure(message: "The image has no pictures in it.")
	}
	let width = picture.width
	let height = picture.height
	let alpha = hasAlpha(picture) ? "own" : "none"
	try writePng(try flatten(picture, width, height), target)
	return "ok\t\(width)\t\(height)\t\(alpha)\t1\t-1\t"
}

func convert(_ sourcePath: String, _ target: String) -> String {
	guard let data = FileManager.default.contents(atPath: sourcePath) else {
		return "failed\tThe image file could not be read."
	}
	guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else {
		return isAvif(data) ? "missing\tThis version of macOS cannot read AVIF images." : "failed\tThe image could not be read."
	}
	let count = CGImageSourceGetCount(source)
	if CGImageSourceGetType(source) == nil || count == 0 {
		return isAvif(data) ? "missing\tThis version of macOS cannot read AVIF images." : "failed\tThe image could not be read."
	}
	do {
		if count > 1 {
			do {
				return try convertSequence(source, count, target)
			} catch {
				return try convertStill(source, target)
			}
		}
		return try convertStill(source, target)
	} catch let failure as CodecFailure {
		return "failed\t" + clean(failure.message)
	} catch {
		return "failed\t" + clean(error.localizedDescription)
	}
}

say("ready")
while let line = readLine(strippingNewline: true) {
	let parts = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
	say(parts.count < 2 ? "failed\tThe request was malformed." : convert(parts[0], parts[1]))
}
