package io.github.arkniem.openhistoria.plugin;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Message;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.View;
import android.view.ViewGroup;

import org.godotengine.godot.Godot;
import org.godotengine.godot.input.GodotEditText;
import org.godotengine.godot.plugin.GodotPlugin;
import org.godotengine.godot.plugin.SignalInfo;
import org.godotengine.godot.plugin.UsedByGodot;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;

public class OpenHistoriaPlugin extends GodotPlugin {
    private SpeechRecognizer recognizer;
    private String speechLocale = "";
    private boolean listening = false;
    private boolean speechReady = false;

    public OpenHistoriaPlugin(Godot godot) {
        super(godot);
    }

    @Override
    public String getPluginName() {
        return "OpenHistoria";
    }

    @Override
    public Set<SignalInfo> getPluginSignals() {
        Set<SignalInfo> signals = new HashSet<>();
        signals.add(new SignalInfo("speech_ready"));
        signals.add(new SignalInfo("speech_partial", String.class));
        signals.add(new SignalInfo("speech_final", String.class));
        signals.add(new SignalInfo("speech_error", String.class));
        signals.add(new SignalInfo("speech_end"));
        return signals;
    }

    @Override
    public void onMainResume() {
        SkipService.appInFront = true;
    }

    @Override
    public void onMainPause() {
        SkipService.appInFront = false;
    }

    @Override
    public void onMainDestroy() {
        runOnUiThread(this::dropRecognizer);
        Context context = getContext();
        if (context != null && SkipService.running) {
            context.startService(new Intent(context, SkipService.class).setAction(SkipService.ACTION_STOP));
        }
    }

    @UsedByGodot
    public boolean skipStart(String title, String text, String doneText, String channel, String doneChannel, String busyFile) {
        Context context = getContext();
        if (context == null) {
            return false;
        }
        Intent intent = new Intent(context, SkipService.class).setAction(SkipService.ACTION_START);
        intent.putExtra("title", title);
        intent.putExtra("text", text);
        intent.putExtra("doneText", doneText);
        intent.putExtra("channel", channel);
        intent.putExtra("doneChannel", doneChannel);
        intent.putExtra("busyFile", busyFile);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    @UsedByGodot
    public void skipUpdate(String text) {
        Context context = getContext();
        if (context == null || !SkipService.running) {
            return;
        }
        try {
            context.startService(new Intent(context, SkipService.class).setAction(SkipService.ACTION_UPDATE).putExtra("text", text));
        } catch (Exception ignored) {
        }
    }

    @UsedByGodot
    public void skipStop() {
        Context context = getContext();
        if (context == null || !SkipService.running) {
            return;
        }
        try {
            context.startService(new Intent(context, SkipService.class).setAction(SkipService.ACTION_STOP));
        } catch (Exception ignored) {
        }
    }

    @UsedByGodot
    public boolean skipRunning() {
        return SkipService.running;
    }

    @UsedByGodot
    public boolean notificationsAllowed() {
        Context context = getContext();
        if (context == null) {
            return false;
        }
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && !manager.areNotificationsEnabled()) {
            return false;
        }
        return Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    @UsedByGodot
    public boolean keyboardBlockedByHardware() {
        Context context = getContext();
        if (context == null) {
            return false;
        }
        Configuration config = context.getResources().getConfiguration();
        boolean hardware = config.keyboard != Configuration.KEYBOARD_NOKEYS && config.hardKeyboardHidden == Configuration.HARDKEYBOARDHIDDEN_NO;
        return hardware && Settings.Secure.getInt(context.getContentResolver(), "show_ime_with_hard_keyboard", 0) == 1;
    }

    @UsedByGodot
    public void showKeyboard(String text, int type, int maxLength, int start, int end) {
        runOnUiThread(() -> sendToEditText(2, text == null ? "" : text, type, maxLength, start, end));
    }

    @UsedByGodot
    public void hideKeyboard() {
        runOnUiThread(() -> sendToEditText(3, "", 0, 0, -1, -1));
    }

    private static GodotEditText findEditText(View view) {
        if (view instanceof GodotEditText) {
            return (GodotEditText) view;
        }
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int at = 0; at < group.getChildCount(); at++) {
                GodotEditText found = findEditText(group.getChildAt(at));
                if (found != null) {
                    return found;
                }
            }
        }
        return null;
    }

    private void sendToEditText(int what, String text, int type, int maxLength, int start, int end) {
        Activity activity = getActivity();
        if (activity == null) {
            return;
        }
        GodotEditText edit = findEditText(activity.getWindow().getDecorView());
        if (edit == null) {
            return;
        }
        try {
            if (what == 2) {
                int limit = maxLength <= 0 ? Integer.MAX_VALUE : maxLength;
                String origin = text;
                if (start != -1) {
                    int cut = Math.min(text.length(), end == -1 ? start : end);
                    origin = text.substring(0, cut);
                    limit = limit - (text.length() - cut);
                }
                setField(edit, "mOriginText", origin);
                setField(edit, "mMaxInputLength", limit);
                GodotEditText.VirtualKeyboardType[] types = GodotEditText.VirtualKeyboardType.values();
                setField(edit, "mKeyboardType", types[Math.max(0, Math.min(types.length - 1, type))]);
            }
            Field field = GodotEditText.class.getDeclaredField("sHandler");
            field.setAccessible(true);
            Handler handler = (Handler) field.get(edit);
            if (handler == null) {
                return;
            }
            Message message = new Message();
            message.what = what;
            message.obj = edit;
            message.arg1 = start;
            message.arg2 = end;
            handler.sendMessage(message);
        } catch (Exception ignored) {
        }
    }

    private static void setField(Object target, String name, Object value) throws Exception {
        Field field = GodotEditText.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    @UsedByGodot
    public boolean speechAvailable() {
        Context context = getContext();
        return context != null && SpeechRecognizer.isRecognitionAvailable(context);
    }

    @UsedByGodot
    public boolean microphoneAllowed() {
        Context context = getContext();
        return context != null && (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
    }

    @UsedByGodot
    public void speechStart(String locale) {
        speechLocale = locale == null ? "" : locale;
        runOnUiThread(() -> {
            dropRecognizer();
            Activity activity = getActivity();
            if (activity == null || !SpeechRecognizer.isRecognitionAvailable(activity)) {
                emitSignal("speech_error", "unavailable");
                return;
            }
            listening = true;
            speechReady = false;
            listen();
        });
    }

    @UsedByGodot
    public void speechStop() {
        runOnUiThread(() -> {
            boolean was = listening;
            dropRecognizer();
            if (was) {
                emitSignal("speech_end");
            }
        });
    }

    private void listen() {
        Activity activity = getActivity();
        if (activity == null || !listening) {
            return;
        }
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(activity);
            recognizer.setRecognitionListener(new Listener());
        }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.getPackageName());
        if (!speechLocale.isEmpty()) {
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, speechLocale);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, speechLocale);
        }
        try {
            recognizer.startListening(intent);
        } catch (Exception error) {
            listening = false;
            emitSignal("speech_error", "failed");
        }
    }

    private void dropRecognizer() {
        listening = false;
        if (recognizer != null) {
            try {
                recognizer.cancel();
                recognizer.destroy();
            } catch (Exception ignored) {
            }
            recognizer = null;
        }
    }

    private static String first(Bundle results) {
        if (results == null) {
            return "";
        }
        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return matches == null || matches.isEmpty() || matches.get(0) == null ? "" : matches.get(0);
    }

    private static String codeOf(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "microphone";
            case 12:
            case 13:
                return "language";
            case SpeechRecognizer.ERROR_AUDIO:
                return "microphone";
            default:
                return "failed";
        }
    }

    private class Listener implements RecognitionListener {
        @Override
        public void onReadyForSpeech(Bundle params) {
            if (!speechReady) {
                speechReady = true;
                emitSignal("speech_ready");
            }
        }

        @Override
        public void onBeginningOfSpeech() {
        }

        @Override
        public void onRmsChanged(float rmsdB) {
        }

        @Override
        public void onBufferReceived(byte[] buffer) {
        }

        @Override
        public void onEndOfSpeech() {
        }

        @Override
        public void onError(int error) {
            if (!listening) {
                return;
            }
            if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT || (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY && speechReady)) {
                listen();
                return;
            }
            listening = false;
            emitSignal("speech_error", codeOf(error));
        }

        @Override
        public void onResults(Bundle results) {
            String text = first(results);
            if (!text.isEmpty()) {
                emitSignal("speech_final", text);
            }
            if (listening) {
                listen();
            }
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            String text = first(partialResults);
            if (!text.isEmpty()) {
                emitSignal("speech_partial", text);
            }
        }

        @Override
        public void onEvent(int eventType, Bundle params) {
        }
    }
}
