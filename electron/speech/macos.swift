/*! Open Historia — macOS's own speech recognition for the Advisor's microphone © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A small command-line program the desktop app starts
// (electron/speechSystem.cjs) to hear the player through SFSpeechRecognizer,
// the recogniser macOS dictates with. Built by scripts/build-speech-helpers.mjs
// with swiftc, its usage descriptions (macos-Info.plist) linked into the
// binary: a program without a bundle has nowhere else to keep them, and macOS
// ends one that asks for speech recognition without them. The prompts name the
// app that started it, whose Info.plist carries the same keys.
//
// Same lines as the Windows program (electron/speech/windows.cs):
//   oh-speech-macos probe
//   oh-speech-macos listen <language tag>
//     {"type":"ready","language":"en-US"} {"type":"partial","text":"..."}
//     {"type":"final","text":"..."} {"type":"error","code":"...","message":"..."}
//     {"type":"end"}
// "stop" on its input (or the end of it) ends a turn. Error codes: denied
// (speech recognition not allowed), microphone, language, failed.
//
// Recognition runs on the Mac where the language's model is there
// (supportsOnDeviceRecognition, macOS 10.15 and later): requiresOnDevice then
// keeps the audio on the Mac. Otherwise Apple's servers recognise it.

import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

var finished = false

func emit(_ object: [String: Any]) {
    if finished { return }
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: []),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

func end(_ status: Int32) -> Never {
    emit(["type": "end"])
    finished = true
    exit(status)
}

func fail(_ code: String, _ message: String) -> Never {
    emit(["type": "error", "code": code, "message": message])
    end(1)
}

func tag(_ locale: Locale) -> String {
    return locale.identifier.replacingOccurrences(of: "_", with: "-")
}

func baseLanguage(_ value: String) -> String {
    return value.split(separator: "-").first.map { String($0).lowercased() } ?? value.lowercased()
}

func authorization(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
}

// The installed recogniser for a tag: the same tag, else the Mac's own locale
// if it speaks the same language, else any of that language.
func pickLocale(_ wanted: String) -> Locale? {
    let locales = Array(SFSpeechRecognizer.supportedLocales())
    if let same = locales.first(where: { tag($0).caseInsensitiveCompare(wanted) == .orderedSame }) { return same }
    let base = baseLanguage(wanted)
    let current = tag(Locale.current)
    if baseLanguage(current) == base, let own = locales.first(where: { tag($0).caseInsensitiveCompare(current) == .orderedSame }) { return own }
    return locales.first(where: { baseLanguage(tag($0)) == base })
}

func probe() -> Never {
    let languages = SFSpeechRecognizer.supportedLocales().map(tag).sorted()
    emit([
        "type": "probe",
        "languages": languages,
        "system": tag(Locale.current),
        "authorization": authorization(SFSpeechRecognizer.authorizationStatus()),
    ])
    finished = true
    exit(0)
}

let engine = AVAudioEngine()
var request: SFSpeechAudioBufferRecognitionRequest?
var task: SFSpeechRecognitionTask?
var stopping = false

func stop() {
    if stopping { return }
    stopping = true
    engine.stop()
    engine.inputNode.removeTap(onBus: 0)
    request?.endAudio()
    // The last result comes once the audio has ended; not waited for long.
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { end(0) }
}

func start(_ locale: Locale) {
    guard let recognizer = SFSpeechRecognizer(locale: locale) else {
        fail("language", "No recogniser for \(tag(locale)).")
    }
    if !recognizer.isAvailable { fail("failed", "The recogniser for \(tag(locale)) is not available now.") }
    let audio = SFSpeechAudioBufferRecognitionRequest()
    audio.shouldReportPartialResults = true
    if #available(macOS 10.15, *), recognizer.supportsOnDeviceRecognition {
        audio.requiresOnDeviceRecognition = true
    }
    if #available(macOS 13, *) { audio.addsPunctuation = true }
    request = audio

    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    if format.sampleRate == 0 || format.channelCount == 0 { fail("microphone", "No microphone input.") }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in audio.append(buffer) }
    engine.prepare()
    do {
        try engine.start()
    } catch {
        fail("microphone", error.localizedDescription)
    }

    // Partial results here are the whole turn so far, not one phrase: each
    // replaces the last, and the final one comes after the audio ends.
    task = recognizer.recognitionTask(with: audio) { result, error in
        if let result = result {
            let text = result.bestTranscription.formattedString
            if !text.isEmpty { emit(["type": result.isFinal ? "final" : "partial", "text": text]) }
            if result.isFinal { end(0) }
        }
        if let error = error {
            if stopping { end(0) }
            fail("failed", error.localizedDescription)
        }
    }
    emit(["type": "ready", "language": tag(locale)])

    // Read on a thread of its own: "stop", or the app closing the pipe.
    Thread.detachNewThread {
        while let line = readLine() {
            if line.trimmingCharacters(in: .whitespaces) == "stop" { break }
        }
        DispatchQueue.main.async { stop() }
    }
}

func listen(_ wanted: String) {
    guard let locale = pickLocale(wanted) else {
        fail("language", "macOS has no recogniser for \(wanted).")
    }
    let afterSpeech: (SFSpeechRecognizerAuthorizationStatus) -> Void = { status in
        DispatchQueue.main.async {
            guard status == .authorized else { fail("denied", "Speech recognition: \(authorization(status)).") }
            let afterMicrophone: (Bool) -> Void = { granted in
                DispatchQueue.main.async {
                    guard granted else { fail("microphone", "The microphone was not allowed.") }
                    start(locale)
                }
            }
            switch AVCaptureDevice.authorizationStatus(for: .audio) {
            case .authorized: afterMicrophone(true)
            case .notDetermined: AVCaptureDevice.requestAccess(for: .audio, completionHandler: afterMicrophone)
            default: afterMicrophone(false)
            }
        }
    }
    let status = SFSpeechRecognizer.authorizationStatus()
    if status == .notDetermined {
        SFSpeechRecognizer.requestAuthorization(afterSpeech)
    } else {
        afterSpeech(status)
    }
}

let arguments = CommandLine.arguments
if arguments.count > 1 && arguments[1] == "probe" { probe() }
if arguments.count > 2 && arguments[1] == "listen" {
    listen(arguments[2])
    dispatchMain()
}
FileHandle.standardError.write("usage: oh-speech-macos probe | listen <language tag>\n".data(using: .utf8)!)
exit(2)
