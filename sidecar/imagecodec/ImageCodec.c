#include <avif/avif.h>
#include <zlib.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define MAX_FRAMES 256
#define PIXEL_BUDGET 24000000ULL

typedef struct {
	uint32_t width;
	uint32_t height;
	uint8_t *pixels;
} Raster;

typedef struct {
	char *text;
	size_t length;
	size_t capacity;
} Text;

static void say(const char *text)
{
	fputs(text, stdout);
	fputc('\n', stdout);
	fflush(stdout);
}

static int append(Text *buffer, const char *piece)
{
	size_t extra = strlen(piece);
	if (buffer->length + extra + 1 > buffer->capacity) {
		size_t next = buffer->capacity ? buffer->capacity : 256;
		while (buffer->length + extra + 1 > next) {
			next *= 2;
		}
		char *grown = realloc(buffer->text, next);
		if (!grown) {
			return 0;
		}
		buffer->text = grown;
		buffer->capacity = next;
	}
	memcpy(buffer->text + buffer->length, piece, extra + 1);
	buffer->length += extra;
	return 1;
}

static char *copyText(const char *text)
{
	char *copy = malloc(strlen(text) + 1);
	if (copy) {
		strcpy(copy, text);
	}
	return copy;
}

static char *failedWith(const char *message)
{
	Text reply = {0};
	append(&reply, "failed\t");
	size_t start = reply.length;
	append(&reply, message);
	for (size_t at = start; reply.text && at < reply.length; at++) {
		if (reply.text[at] == '\t' || reply.text[at] == '\r' || reply.text[at] == '\n') {
			reply.text[at] = ' ';
		}
	}
	return reply.text ? reply.text : copyText("failed\tThe helper ran out of memory.");
}

static char *failedBecause(const char *lead, avifResult result)
{
	char message[512];
	snprintf(message, sizeof message, "%s (%s).", lead, avifResultToString(result));
	return failedWith(message);
}

static int startsWith(const char *text, const char *prefix)
{
	return text && strncmp(text, prefix, strlen(prefix)) == 0;
}

static uint8_t *readAll(const char *file, size_t *size)
{
	FILE *handle = fopen(file, "rb");
	if (!handle) {
		return NULL;
	}
	size_t capacity = 1 << 20;
	size_t length = 0;
	uint8_t *data = malloc(capacity);
	while (data) {
		if (length == capacity) {
			capacity *= 2;
			uint8_t *grown = realloc(data, capacity);
			if (!grown) {
				free(data);
				data = NULL;
				break;
			}
			data = grown;
		}
		size_t got = fread(data + length, 1, capacity - length, handle);
		length += got;
		if (got == 0) {
			break;
		}
	}
	int failed = ferror(handle);
	fclose(handle);
	if (failed) {
		free(data);
		return NULL;
	}
	*size = length;
	return data;
}

static uint32_t be32(const uint8_t *at)
{
	return ((uint32_t)at[0] << 24) | ((uint32_t)at[1] << 16) | ((uint32_t)at[2] << 8) | (uint32_t)at[3];
}

static int isAvif(const uint8_t *data, size_t size)
{
	if (size < 16 || memcmp(data + 4, "ftyp", 4) != 0) {
		return 0;
	}
	size_t box = be32(data);
	size_t end = size;
	size_t limit = box >= 16 ? box : 16;
	if (limit < end) {
		end = limit;
	}
	if (end > 256) {
		end = 256;
	}
	for (size_t at = 8; at + 4 <= end; at += 4) {
		if (at == 12) {
			continue;
		}
		if (memcmp(data + at, "avif", 4) == 0 || memcmp(data + at, "avis", 4) == 0) {
			return 1;
		}
	}
	return 0;
}

static int hasTopBox(const uint8_t *data, size_t size, const char *type)
{
	size_t at = 0;
	while (at + 8 <= size) {
		uint64_t box = be32(data + at);
		size_t header = 8;
		if (box == 1) {
			if (at + 16 > size) {
				return 0;
			}
			box = ((uint64_t)be32(data + at + 8) << 32) | be32(data + at + 12);
			header = 16;
		} else if (box == 0) {
			box = size - at;
		}
		if (box < header || box > size - at) {
			return 0;
		}
		if (memcmp(data + at + 4, type, 4) == 0) {
			return 1;
		}
		at += (size_t)box;
	}
	return 0;
}

static uint8_t *sequenceOnly(const uint8_t *data, size_t size)
{
	if (size < 16 || memcmp(data + 4, "ftyp", 4) != 0 || hasTopBox(data, size, "meta") || !hasTopBox(data, size, "moov")) {
		return NULL;
	}
	size_t end = be32(data);
	if (end < 16 || end > size) {
		return NULL;
	}
	uint8_t *copy = malloc(size);
	if (!copy) {
		return NULL;
	}
	memcpy(copy, data, size);
	int changed = 0;
	for (size_t at = 8; at + 4 <= end; at += 4) {
		if (at == 12) {
			continue;
		}
		if (memcmp(copy + at, "avif", 4) == 0 || memcmp(copy + at, "mif1", 4) == 0 || memcmp(copy + at, "miaf", 4) == 0) {
			memcpy(copy + at, "avis", 4);
			changed = 1;
		}
	}
	if (!changed) {
		free(copy);
		return NULL;
	}
	return copy;
}

static int makeParents(const char *file)
{
	char *path = copyText(file);
	if (!path) {
		return 0;
	}
	for (char *at = path + 1; *at; at++) {
		if (*at != '/') {
			continue;
		}
		*at = '\0';
		if (mkdir(path, 0755) != 0 && errno != EEXIST) {
			free(path);
			return 0;
		}
		*at = '/';
	}
	free(path);
	return 1;
}

static int writeChunk(FILE *file, const char *type, const uint8_t *data, size_t length)
{
	uint8_t head[8];
	head[0] = (uint8_t)(length >> 24);
	head[1] = (uint8_t)(length >> 16);
	head[2] = (uint8_t)(length >> 8);
	head[3] = (uint8_t)length;
	memcpy(head + 4, type, 4);
	uLong crc = crc32(0L, (const Bytef *)type, 4);
	if (length) {
		crc = crc32(crc, data, (uInt)length);
	}
	uint8_t tail[4] = {(uint8_t)(crc >> 24), (uint8_t)(crc >> 16), (uint8_t)(crc >> 8), (uint8_t)crc};
	if (fwrite(head, 1, 8, file) != 8) {
		return 0;
	}
	if (length && fwrite(data, 1, length, file) != length) {
		return 0;
	}
	return fwrite(tail, 1, 4, file) == 4;
}

static uint8_t paeth(uint8_t left, uint8_t up, uint8_t corner)
{
	int guess = (int)left + (int)up - (int)corner;
	int toLeft = abs(guess - (int)left);
	int toUp = abs(guess - (int)up);
	int toCorner = abs(guess - (int)corner);
	if (toLeft <= toUp && toLeft <= toCorner) {
		return left;
	}
	return toUp <= toCorner ? up : corner;
}

static void filterRow(int kind, const uint8_t *row, const uint8_t *above, size_t bytes, uint8_t *out)
{
	for (size_t at = 0; at < bytes; at++) {
		uint8_t left = at >= 4 ? row[at - 4] : 0;
		uint8_t up = above ? above[at] : 0;
		uint8_t corner = above && at >= 4 ? above[at - 4] : 0;
		uint8_t value = row[at];
		switch (kind) {
		case 1:
			out[at] = (uint8_t)(value - left);
			break;
		case 2:
			out[at] = (uint8_t)(value - up);
			break;
		case 3:
			out[at] = (uint8_t)(value - (uint8_t)(((int)left + (int)up) / 2));
			break;
		case 4:
			out[at] = (uint8_t)(value - paeth(left, up, corner));
			break;
		default:
			out[at] = value;
			break;
		}
	}
}

static unsigned long rowCost(const uint8_t *row, size_t bytes)
{
	unsigned long total = 0;
	for (size_t at = 0; at < bytes; at++) {
		total += (unsigned long)abs((int)(int8_t)row[at]);
	}
	return total;
}

static int writePng(const Raster *picture, const char *target)
{
	size_t stride = (size_t)picture->width * 4;
	size_t rawSize = (stride + 1) * picture->height;
	uint8_t *raw = malloc(rawSize);
	uint8_t *trial = malloc(stride ? stride : 1);
	if (!raw || !trial) {
		free(raw);
		free(trial);
		return 0;
	}
	for (uint32_t y = 0; y < picture->height; y++) {
		const uint8_t *row = picture->pixels + stride * y;
		const uint8_t *above = y ? picture->pixels + stride * (y - 1) : NULL;
		uint8_t *line = raw + (stride + 1) * y;
		int best = 0;
		unsigned long bestCost = 0;
		for (int kind = 0; kind < 5; kind++) {
			filterRow(kind, row, above, stride, trial);
			unsigned long cost = rowCost(trial, stride);
			if (kind == 0 || cost < bestCost) {
				best = kind;
				bestCost = cost;
				memcpy(line + 1, trial, stride);
			}
		}
		line[0] = (uint8_t)best;
	}
	free(trial);
	uLongf packedSize = compressBound((uLong)rawSize);
	uint8_t *packed = malloc(packedSize);
	if (!packed || compress2(packed, &packedSize, raw, (uLong)rawSize, 6) != Z_OK) {
		free(raw);
		free(packed);
		return 0;
	}
	free(raw);
	if (!makeParents(target)) {
		free(packed);
		return 0;
	}
	size_t nameSize = strlen(target) + 6;
	char *partial = malloc(nameSize);
	if (!partial) {
		free(packed);
		return 0;
	}
	snprintf(partial, nameSize, "%s.part", target);
	FILE *file = fopen(partial, "wb");
	int ok = file != NULL;
	if (ok) {
		static const uint8_t signature[8] = {0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'};
		uint8_t header[13] = {
			(uint8_t)(picture->width >> 24), (uint8_t)(picture->width >> 16), (uint8_t)(picture->width >> 8), (uint8_t)picture->width,
			(uint8_t)(picture->height >> 24), (uint8_t)(picture->height >> 16), (uint8_t)(picture->height >> 8), (uint8_t)picture->height,
			8, 6, 0, 0, 0,
		};
		ok = fwrite(signature, 1, 8, file) == 8 && writeChunk(file, "IHDR", header, 13) && writeChunk(file, "IDAT", packed, packedSize) && writeChunk(file, "IEND", NULL, 0);
		ok = fclose(file) == 0 && ok;
	}
	free(packed);
	if (ok) {
		ok = rename(partial, target) == 0;
	}
	if (!ok) {
		unlink(partial);
	}
	free(partial);
	return ok;
}

static int toRaster(const avifImage *image, Raster *out)
{
	avifRGBImage rgb;
	avifRGBImageSetDefaults(&rgb, image);
	rgb.format = AVIF_RGB_FORMAT_RGBA;
	rgb.depth = 8;
	rgb.alphaPremultiplied = AVIF_FALSE;
	if (avifRGBImageAllocatePixels(&rgb) != AVIF_RESULT_OK) {
		return 0;
	}
	if (avifImageYUVToRGB(image, &rgb) != AVIF_RESULT_OK) {
		avifRGBImageFreePixels(&rgb);
		return 0;
	}
	size_t stride = (size_t)rgb.width * 4;
	uint8_t *pixels = malloc(stride * rgb.height);
	if (!pixels) {
		avifRGBImageFreePixels(&rgb);
		return 0;
	}
	for (uint32_t y = 0; y < rgb.height; y++) {
		memcpy(pixels + stride * y, rgb.pixels + (size_t)rgb.rowBytes * y, stride);
	}
	avifRGBImageFreePixels(&rgb);
	out->width = rgb.width;
	out->height = rgb.height;
	out->pixels = pixels;
	return 1;
}

static int rotateCounterClockwise(Raster *picture)
{
	uint32_t width = picture->width;
	uint32_t height = picture->height;
	uint8_t *turned = malloc((size_t)width * height * 4);
	if (!turned) {
		return 0;
	}
	for (uint32_t y = 0; y < width; y++) {
		for (uint32_t x = 0; x < height; x++) {
			const uint8_t *from = picture->pixels + ((size_t)x * width + (width - 1 - y)) * 4;
			memcpy(turned + ((size_t)y * height + x) * 4, from, 4);
		}
	}
	free(picture->pixels);
	picture->pixels = turned;
	picture->width = height;
	picture->height = width;
	return 1;
}

static void flip(Raster *picture, int vertically)
{
	size_t stride = (size_t)picture->width * 4;
	if (vertically) {
		uint8_t *spare = malloc(stride);
		if (!spare) {
			return;
		}
		for (uint32_t y = 0; y < picture->height / 2; y++) {
			uint8_t *top = picture->pixels + stride * y;
			uint8_t *bottom = picture->pixels + stride * (picture->height - 1 - y);
			memcpy(spare, top, stride);
			memcpy(top, bottom, stride);
			memcpy(bottom, spare, stride);
		}
		free(spare);
		return;
	}
	for (uint32_t y = 0; y < picture->height; y++) {
		uint8_t *row = picture->pixels + stride * y;
		for (uint32_t x = 0; x < picture->width / 2; x++) {
			uint8_t *left = row + (size_t)x * 4;
			uint8_t *right = row + (size_t)(picture->width - 1 - x) * 4;
			uint8_t spare[4];
			memcpy(spare, left, 4);
			memcpy(left, right, 4);
			memcpy(right, spare, 4);
		}
	}
}

static int orient(Raster *picture, const avifImage *image)
{
	if (image->transformFlags & AVIF_TRANSFORM_IROT) {
		for (int turn = 0; turn < (image->irot.angle & 3); turn++) {
			if (!rotateCounterClockwise(picture)) {
				return 0;
			}
		}
	}
	if (image->transformFlags & AVIF_TRANSFORM_IMIR) {
		flip(picture, (image->imir.axis & 1) == 0);
	}
	return 1;
}

static char *framePath(const char *target, int index)
{
	size_t length = strlen(target);
	size_t stem = length >= 4 && strcasecmp(target + length - 4, ".png") == 0 ? length - 4 : length;
	size_t size = stem + 32;
	char *path = malloc(size);
	if (path) {
		snprintf(path, size, "%.*s.%d.png", (int)stem, target, index);
	}
	return path;
}

static void seconds(double value, char *out, size_t size)
{
	snprintf(out, size, "%.6f", value);
	size_t length = strlen(out);
	while (length > 0 && out[length - 1] == '0') {
		out[--length] = '\0';
	}
	if (length > 0 && out[length - 1] == '.') {
		out[--length] = '\0';
	}
}

static int threads(void)
{
	long count = sysconf(_SC_NPROCESSORS_ONLN);
	if (count < 1) {
		return 1;
	}
	return count > 4 ? 4 : (int)count;
}

static avifDecoder *openDecoder(const uint8_t *data, size_t size, avifDecoderSource source, avifResult *result)
{
	avifDecoder *decoder = avifDecoderCreate();
	if (!decoder) {
		*result = AVIF_RESULT_OUT_OF_MEMORY;
		return NULL;
	}
	decoder->maxThreads = threads();
	decoder->strictFlags = AVIF_STRICT_DISABLED;
	decoder->ignoreExif = AVIF_TRUE;
	decoder->ignoreXMP = AVIF_TRUE;
	decoder->requestedSource = source;
	*result = avifDecoderSetIOMemory(decoder, data, size);
	if (*result == AVIF_RESULT_OK) {
		*result = avifDecoderParse(decoder);
	}
	if (*result != AVIF_RESULT_OK) {
		avifDecoderDestroy(decoder);
		return NULL;
	}
	return decoder;
}

static int loopsOf(const avifDecoder *decoder)
{
	int count = decoder->repetitionCount;
	return count < 0 ? -1 : count;
}

static char *convertSequence(avifDecoder *decoder, const char *target)
{
	avifResult result = avifDecoderNextImage(decoder);
	if (result != AVIF_RESULT_OK) {
		return failedBecause("The picture sequence has no pictures in it", result);
	}
	Raster first = {0};
	if (!toRaster(decoder->image, &first)) {
		return failedWith("The first picture could not be converted.");
	}
	uint32_t width = first.width;
	uint32_t height = first.height;
	unsigned long long area = (unsigned long long)width * height;
	unsigned long long budget = PIXEL_BUDGET / (area ? area : 1);
	if (budget > MAX_FRAMES) {
		budget = MAX_FRAMES;
	}
	if (budget < 1) {
		budget = 1;
	}
	int limit = decoder->imageCount > 0 && (unsigned long long)decoder->imageCount < budget ? decoder->imageCount : (int)budget;
	Text timings = {0};
	append(&timings, "");
	int written = 0;
	for (int index = 0; index < limit; index++) {
		Raster picture = {0};
		if (index == 0) {
			picture = first;
		} else {
			if (avifDecoderNextImage(decoder) != AVIF_RESULT_OK || !toRaster(decoder->image, &picture)) {
				break;
			}
		}
		char *path = index == 0 ? copyText(target) : framePath(target, index);
		int ok = path && writePng(&picture, path);
		free(path);
		free(picture.pixels);
		if (!ok) {
			free(timings.text);
			return failedWith("The PNG file could not be written.");
		}
		double delay = decoder->imageTiming.duration;
		char piece[64];
		seconds(delay <= 0.010 ? 0.1 : delay, piece, sizeof piece);
		if (written) {
			append(&timings, ",");
		}
		append(&timings, piece);
		written += 1;
	}
	char head[160];
	snprintf(head, sizeof head, "ok\t%u\t%u\t%s\t%d\t%d\t", width, height, decoder->alphaPresent ? "track" : "none", written, loopsOf(decoder));
	Text reply = {0};
	append(&reply, head);
	append(&reply, timings.text ? timings.text : "");
	free(timings.text);
	return reply.text ? reply.text : failedWith("The helper ran out of memory.");
}

static char *convertStill(avifDecoder *decoder, const char *target)
{
	avifResult result = avifDecoderNextImage(decoder);
	if (result != AVIF_RESULT_OK) {
		return failedBecause("The image could not be decoded", result);
	}
	Raster picture = {0};
	if (!toRaster(decoder->image, &picture)) {
		return failedWith("The picture could not be converted.");
	}
	if (!orient(&picture, decoder->image)) {
		free(picture.pixels);
		return failedWith("The picture could not be turned.");
	}
	int ok = writePng(&picture, target);
	free(picture.pixels);
	if (!ok) {
		return failedWith("The PNG file could not be written.");
	}
	char reply[160];
	snprintf(reply, sizeof reply, "ok\t%u\t%u\t%s\t1\t-1\t", picture.width, picture.height, decoder->alphaPresent ? "own" : "none");
	return copyText(reply);
}

static char *convertFile(const char *source, const char *target)
{
	size_t size = 0;
	uint8_t *data = readAll(source, &size);
	if (!data) {
		return copyText("failed\tThe image file could not be read.");
	}
	int avif = isAvif(data, size);
	avifResult result = AVIF_RESULT_OK;
	avifDecoder *probe = openDecoder(data, size, AVIF_DECODER_SOURCE_AUTO, &result);
	if (!probe) {
		uint8_t *patched = sequenceOnly(data, size);
		if (patched) {
			avifResult retried = AVIF_RESULT_OK;
			probe = openDecoder(patched, size, AVIF_DECODER_SOURCE_AUTO, &retried);
			if (probe) {
				free(data);
				data = patched;
			} else {
				free(patched);
			}
		}
	}
	if (!probe) {
		free(data);
		return avif ? failedBecause("The image could not be read", result) : copyText("failed\tThe image could not be read.");
	}
	int sequence = probe->imageSequenceTrackPresent;
	avifDecoderDestroy(probe);
	char *answer = NULL;
	if (sequence) {
		avifDecoder *tracks = openDecoder(data, size, AVIF_DECODER_SOURCE_TRACKS, &result);
		answer = tracks ? convertSequence(tracks, target) : failedBecause("The picture sequence could not be read", result);
		if (tracks) {
			avifDecoderDestroy(tracks);
		}
		if (startsWith(answer, "ok\t")) {
			free(data);
			return answer;
		}
	}
	avifDecoder *still = openDecoder(data, size, AVIF_DECODER_SOURCE_PRIMARY_ITEM, &result);
	if (!still) {
		free(data);
		return answer ? answer : failedBecause("The image could not be read", result);
	}
	free(answer);
	answer = convertStill(still, target);
	avifDecoderDestroy(still);
	free(data);
	return answer;
}

static char *probe(const char *file)
{
	char text[512];
	size_t size = 0;
	uint8_t *data = readAll(file, &size);
	if (!data) {
		snprintf(text, sizeof text, "probe\tlibavif %s; the file could not be read", avifVersion());
		return copyText(text);
	}
	avifResult result = AVIF_RESULT_OK;
	avifDecoder *decoder = openDecoder(data, size, AVIF_DECODER_SOURCE_AUTO, &result);
	if (!decoder) {
		snprintf(text, sizeof text, "probe\tlibavif %s; %s", avifVersion(), avifResultToString(result));
	} else {
		snprintf(text, sizeof text, "probe\tlibavif %s; %ux%u depth %u alpha %d sequence %d images %d repetitions %d transforms %u", avifVersion(), decoder->image->width, decoder->image->height, decoder->image->depth, decoder->alphaPresent, decoder->imageSequenceTrackPresent, decoder->imageCount, decoder->repetitionCount, (unsigned)decoder->image->transformFlags);
		avifDecoderDestroy(decoder);
	}
	free(data);
	return copyText(text);
}

int main(void)
{
	say("ready");
	char *line = NULL;
	size_t capacity = 0;
	ssize_t length;
	while ((length = getline(&line, &capacity, stdin)) >= 0) {
		while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
			line[--length] = '\0';
		}
		char *reply = NULL;
		char *tab = strchr(line, '\t');
		if (!tab) {
			reply = copyText("failed\tThe request was malformed.");
		} else {
			*tab = '\0';
			char *target = tab + 1;
			char *extra = strchr(target, '\t');
			if (extra) {
				*extra = '\0';
			}
			reply = strcmp(line, "probe") == 0 ? probe(target) : convertFile(line, target);
		}
		say(reply ? reply : "failed\tThe helper ran out of memory.");
		free(reply);
	}
	free(line);
	return 0;
}
