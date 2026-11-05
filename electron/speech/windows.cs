/*! Open Historia — Windows' own speech recognition for the Advisor's microphone © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A small console program the desktop app starts (electron/speechSystem.cjs)
// to hear the player through Windows.Media.SpeechRecognition, the recogniser
// Windows itself dictates with. Built by scripts/build-speech-helpers.mjs with
// the C# compiler every Windows has (.NET Framework 4), against the Windows
// Runtime's own metadata, so the app needs no native Node module for it.
//
//   oh-speech-windows.exe probe
//       one line: {"type":"probe","languages":[...],"system":"en-US","privacy":true}
//       languages are the dictation languages installed; privacy is the
//       "Online speech recognition" switch as the registry has it (true, false,
//       or null when it says nothing).
//   oh-speech-windows.exe listen <language tag>
//       listens on the default microphone until a line "stop" (or the end of
//       its input) comes in, writing one JSON line per event:
//         {"type":"ready","language":"en-US"}   listening
//         {"type":"partial","text":"..."}       the phrase so far
//         {"type":"final","text":"..."}         a phrase, finished
//         {"type":"error","code":"privacy|language|microphone|network|failed","message":"..."}
//         {"type":"end"}                         the last line
//
// Windows dictates through Microsoft's online service: it refuses to start
// (0x80045509) unless the player has switched on Online speech recognition
// (Settings > Privacy & security > Speech), and while it runs the audio goes to
// Microsoft. The app falls back to Whisper on the device whenever this says
// "error".
//
// C# 5: the compiler that ships with Windows knows no later language.

using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using Microsoft.Win32;
using Windows.Foundation;
using Windows.Globalization;
using Windows.Media.SpeechRecognition;

internal static class OhSpeech
{
    private static readonly object WriteLock = new object();
    private static bool ended;

    // The .NET Framework's bridge to the Windows Runtime's awaitables wants a
    // Windows.winmd that only the Windows SDK has, so the operations are waited
    // for by their status instead; GetResults throws what went wrong.
    private static bool Settle(IAsyncInfo operation, int timeoutMs)
    {
        DateTime until = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (operation.Status == AsyncStatus.Started)
        {
            if (DateTime.UtcNow > until) return false;
            Thread.Sleep(10);
        }
        return true;
    }

    private static T Await<T>(IAsyncOperation<T> operation)
    {
        Settle(operation, int.MaxValue);
        return operation.GetResults();
    }

    private static void Await(IAsyncAction operation, int timeoutMs)
    {
        if (Settle(operation, timeoutMs)) operation.GetResults();
    }

    private static string Json(string value)
    {
        if (value == null) return "null";
        var builder = new StringBuilder(value.Length + 2);
        builder.Append('"');
        foreach (char c in value)
        {
            switch (c)
            {
                case '"': builder.Append("\\\""); break;
                case '\\': builder.Append("\\\\"); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default:
                    if (c < ' ') builder.Append("\\u").Append(((int)c).ToString("x4"));
                    else builder.Append(c);
                    break;
            }
        }
        builder.Append('"');
        return builder.ToString();
    }

    private static void Emit(string line)
    {
        lock (WriteLock)
        {
            if (ended) return;
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
    }

    private static void EmitText(string type, string text)
    {
        Emit("{\"type\":\"" + type + "\",\"text\":" + Json(text) + "}");
    }

    private static void EmitError(string code, string message)
    {
        Emit("{\"type\":\"error\",\"code\":\"" + code + "\",\"message\":" + Json(message) + "}");
    }

    private static void End()
    {
        Emit("{\"type\":\"end\"}");
        lock (WriteLock) ended = true;
    }

    // The "Online speech recognition" switch. Windows keeps the answer here;
    // null when it was never asked, which Windows treats as "no".
    private static string PrivacyAccepted()
    {
        try
        {
            using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Speech_OneCore\Settings\OnlineSpeechPrivacy"))
            {
                if (key == null) return "null";
                object value = key.GetValue("HasAccepted");
                if (value == null) return "null";
                return Convert.ToInt32(value) == 1 ? "true" : "false";
            }
        }
        catch
        {
            return "null";
        }
    }

    private static List<string> TopicLanguages()
    {
        var tags = new List<string>();
        foreach (Language language in SpeechRecognizer.SupportedTopicLanguages) tags.Add(language.LanguageTag);
        return tags;
    }

    private static int Probe()
    {
        var parts = new List<string>();
        string system = null;
        try
        {
            foreach (string tag in TopicLanguages()) parts.Add(Json(tag));
            system = SpeechRecognizer.SystemSpeechLanguage.LanguageTag;
        }
        catch (Exception error)
        {
            EmitError("failed", error.Message);
            return 1;
        }
        Emit("{\"type\":\"probe\",\"languages\":[" + string.Join(",", parts) + "],\"system\":" + Json(system) + ",\"privacy\":" + PrivacyAccepted() + "}");
        return 0;
    }

    // The installed dictation language for a tag: the same tag, else the
    // system's own if it speaks the same language, else any of that language.
    private static string PickLanguage(string wanted)
    {
        List<string> tags = TopicLanguages();
        string wantedBase = wanted.Split('-')[0];
        foreach (string tag in tags) if (string.Equals(tag, wanted, StringComparison.OrdinalIgnoreCase)) return tag;
        string system = SpeechRecognizer.SystemSpeechLanguage.LanguageTag;
        if (string.Equals(system.Split('-')[0], wantedBase, StringComparison.OrdinalIgnoreCase) && tags.Contains(system)) return system;
        foreach (string tag in tags) if (string.Equals(tag.Split('-')[0], wantedBase, StringComparison.OrdinalIgnoreCase)) return tag;
        return null;
    }

    private static string ErrorCode(Exception error)
    {
        uint hresult = unchecked((uint)error.HResult);
        if (hresult == 0x80045509) return "privacy";
        if (hresult == 0x80070005) return "microphone";
        if (hresult == 0x8004503A || hresult == 0x80045054) return "language";
        return "failed";
    }

    private static string StatusCode(SpeechRecognitionResultStatus status)
    {
        switch (status)
        {
            case SpeechRecognitionResultStatus.Success:
            case SpeechRecognitionResultStatus.UserCanceled:
            case SpeechRecognitionResultStatus.TimeoutExceeded:
            case SpeechRecognitionResultStatus.PauseLimitExceeded:
                return null;
            case SpeechRecognitionResultStatus.MicrophoneUnavailable: return "microphone";
            case SpeechRecognitionResultStatus.NetworkFailure: return "network";
            case SpeechRecognitionResultStatus.TopicLanguageNotSupported: return "language";
            default: return "failed";
        }
    }

    private static Exception Inner(Exception error)
    {
        while (error is AggregateException && error.InnerException != null) error = error.InnerException;
        return error;
    }

    private static int Listen(string wanted)
    {
        string tag;
        try
        {
            tag = PickLanguage(wanted);
        }
        catch (Exception error)
        {
            EmitError("failed", error.Message);
            End();
            return 1;
        }
        if (tag == null)
        {
            EmitError("language", "Windows has no dictation language for " + wanted + ".");
            End();
            return 1;
        }

        SpeechRecognizer recognizer = null;
        var completed = new ManualResetEventSlim(false);
        try
        {
            recognizer = new SpeechRecognizer(new Language(tag));
            // Dictation, the recogniser's own topic when given no constraint.
            SpeechRecognitionCompilationResult compiled = Await(recognizer.CompileConstraintsAsync());
            if (compiled.Status != SpeechRecognitionResultStatus.Success)
            {
                EmitError(StatusCode(compiled.Status) ?? "failed", "Dictation did not compile: " + compiled.Status);
                End();
                return 1;
            }
            // The app's own rule ends the turn (three seconds of silence, or
            // twenty with no word); Windows' would stop sooner.
            SpeechContinuousRecognitionSession session = recognizer.ContinuousRecognitionSession;
            session.AutoStopSilenceTimeout = TimeSpan.FromMinutes(5);
            recognizer.HypothesisGenerated += new TypedEventHandler<SpeechRecognizer, SpeechRecognitionHypothesisGeneratedEventArgs>((sender, args) =>
            {
                string text = args.Hypothesis != null ? args.Hypothesis.Text : null;
                if (!string.IsNullOrWhiteSpace(text)) EmitText("partial", text);
            });
            session.ResultGenerated += new TypedEventHandler<SpeechContinuousRecognitionSession, SpeechContinuousRecognitionResultGeneratedEventArgs>((sender, args) =>
            {
                SpeechRecognitionResult result = args.Result;
                if (result == null || result.Status != SpeechRecognitionResultStatus.Success) return;
                if (result.Confidence == SpeechRecognitionConfidence.Rejected) return;
                if (!string.IsNullOrWhiteSpace(result.Text)) EmitText("final", result.Text);
            });
            session.Completed += new TypedEventHandler<SpeechContinuousRecognitionSession, SpeechContinuousRecognitionCompletedEventArgs>((sender, args) =>
            {
                string code = StatusCode(args.Status);
                if (code != null) EmitError(code, "Recognition ended: " + args.Status);
                completed.Set();
            });
            Await(session.StartAsync(), int.MaxValue);
        }
        catch (Exception raw)
        {
            Exception error = Inner(raw);
            EmitError(ErrorCode(error), string.Format("0x{0:X8} {1}", error.HResult, error.Message));
            End();
            if (recognizer != null) recognizer.Dispose();
            return 1;
        }

        Emit("{\"type\":\"ready\",\"language\":" + Json(tag) + "}");

        // The app writes "stop", or closes the pipe (it went away): either way
        // the session ends. Read on a thread so a session that ends by itself
        // (the microphone unplugged) ends the program too.
        var reader = new Thread(() =>
        {
            try
            {
                string line;
                while ((line = Console.In.ReadLine()) != null)
                {
                    if (line.Trim() == "stop") break;
                }
            }
            catch { }
            completed.Set();
        });
        reader.IsBackground = true;
        reader.Start();
        completed.Wait();

        try
        {
            // StopAsync hands over what was still being heard; CancelAsync
            // would drop it. A session that already ended throws here.
            Await(recognizer.ContinuousRecognitionSession.StopAsync(), 3000);
        }
        catch { }
        End();
        recognizer.Dispose();
        return 0;
    }

    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.InputEncoding = new UTF8Encoding(false);
        string mode = args.Length > 0 ? args[0] : "";
        if (mode == "probe") return Probe();
        if (mode == "listen" && args.Length > 1) return Listen(args[1]);
        Console.Error.WriteLine("usage: oh-speech-windows probe | listen <language tag>");
        return 2;
    }
}
