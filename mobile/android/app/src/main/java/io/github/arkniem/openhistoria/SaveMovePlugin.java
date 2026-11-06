/*! Open Historia — moving the saves from the app's old id to its new one © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
package io.github.arkniem.openhistoria;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// The app's id changed in November 2026, and an Android app cannot be updated to
// another id: the app under the new id is a separate app, with a sandbox of its
// own, and the player's games stayed in the old one's. The old id got one last
// build of this same code (build.gradle, OH_ANDROID_LEGACY_APP_ID): the handover.
// The page's half is src/runtime/native/appMove.js.
//
// In the handover build (BuildConfig.OH_MOVE_TO names the new app):
//   info()            whether the new app is installed, and signed like this one;
//   begin(), append() the page writes its packed saves into this app's cache,
//                     a piece at a time (the bridge only carries text);
//   send()            hands that file to the new app's SaveMoveActivity, by an
//                     explicit intent with a read grant on a content:// address
//                     of this app's FileProvider, and answers once the new app
//                     has kept its copy;
//   open()            starts the new app.
// The new app is found by its id, which is the app's own; nothing in the app
// names the old one.
//
// In the app (OH_MOVE_TO empty), the file SaveMoveActivity kept waits in
// files/save-move/ until the page has merged it: info() gives its path, done()
// deletes it.
@CapacitorPlugin(name = "OhSaveMove")
public class SaveMovePlugin extends Plugin {
    private static final String TAG = "OpenHistoria";
    static final String FOLDER = "save-move";
    static final String INCOMING = "incoming.ohmv";
    private static final String OUTGOING = "outgoing.ohmv";
    // The class is the same in every build: the namespace never changed.
    static final String RECEIVER = "io.github.arkniem.openhistoria.SaveMoveActivity";
    static final String ACTION_MOVE_SAVES = "io.github.arkniem.openhistoria.action.MOVE_SAVES";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    static File incomingFile(Context context) {
        return new File(new File(context.getFilesDir(), FOLDER), INCOMING);
    }

    private File outgoingFolder() {
        return new File(getContext().getCacheDir(), FOLDER);
    }

    private File outgoingPart() {
        return new File(outgoingFolder(), OUTGOING + ".part");
    }

    private File outgoingFile() {
        return new File(outgoingFolder(), OUTGOING);
    }

    private static String moveTo() {
        return BuildConfig.OH_MOVE_TO == null ? "" : BuildConfig.OH_MOVE_TO;
    }

    // "same": the new app is installed and signed with this app's key; "other":
    // an app with its id is installed, signed with another key (a copy built by
    // someone else), which gets nothing; "none": not installed.
    private String targetState() {
        String target = moveTo();
        if (target.isEmpty()) return "none";
        PackageManager packages = getContext().getPackageManager();
        try {
            packages.getPackageInfo(target, 0);
        } catch (PackageManager.NameNotFoundException missing) {
            return "none";
        }
        return packages.checkSignatures(getContext().getPackageName(), target) == PackageManager.SIGNATURE_MATCH ? "same" : "other";
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject answer = new JSObject();
        String target = moveTo();
        answer.put("moveTo", target);
        answer.put("target", target.isEmpty() ? "none" : targetState());
        File incoming = incomingFile(getContext());
        answer.put("incoming", target.isEmpty() && incoming.isFile() ? incoming.getAbsolutePath() : "");
        call.resolve(answer);
    }

    // The app: the page has merged the file (or given up on it).
    @PluginMethod
    public void done(PluginCall call) {
        executor.execute(() -> {
            File incoming = incomingFile(getContext());
            if (incoming.isFile() && !incoming.delete()) Log.w(TAG, "The moved saves' file could not be deleted.");
            call.resolve();
        });
    }

    @PluginMethod
    public void begin(PluginCall call) {
        if (moveTo().isEmpty()) {
            call.reject("This app has no other app to move its games to.");
            return;
        }
        executor.execute(() -> {
            File folder = outgoingFolder();
            if (!folder.isDirectory() && !folder.mkdirs()) {
                call.reject("There is no room to pack the games.");
                return;
            }
            outgoingPart().delete();
            outgoingFile().delete();
            call.resolve();
        });
    }

    @PluginMethod
    public void append(PluginCall call) {
        String data = call.getString("data", "");
        executor.execute(() -> {
            try (OutputStream out = new FileOutputStream(outgoingPart(), true)) {
                out.write(Base64.decode(data, Base64.DEFAULT));
                call.resolve();
            } catch (IOException | IllegalArgumentException error) {
                call.reject("The games could not be packed: " + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void send(PluginCall call) {
        String target = moveTo();
        if (target.isEmpty() || !"same".equals(targetState())) {
            call.reject("The new app is not installed.");
            return;
        }
        executor.execute(() -> {
            File file = outgoingFile();
            if (!outgoingPart().renameTo(file)) {
                call.reject("The packed games are missing.");
                return;
            }
            Context context = getContext();
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(ACTION_MOVE_SAVES);
            intent.setComponent(new ComponentName(target, RECEIVER));
            intent.setDataAndType(uri, "application/octet-stream");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            // For a result: that is what tells the new app which app is calling
            // (getCallingPackage), and so whether to trust it.
            getActivity().runOnUiThread(() -> {
                try {
                    startActivityForResult(call, intent, "sent");
                } catch (Exception error) {
                    file.delete();
                    call.reject("The new app could not be reached: " + error.getMessage());
                }
            });
        });
    }

    @ActivityCallback
    private void sent(PluginCall call, ActivityResult result) {
        outgoingFile().delete();
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_OK) {
            Log.i(TAG, "The new app has the games.");
            call.resolve();
        } else {
            call.reject("The new app did not take the games.");
        }
    }

    // Starts the new app, signed like this one.
    @PluginMethod
    public void open(PluginCall call) {
        if (!"same".equals(targetState())) {
            call.reject("The new app is not installed.");
            return;
        }
        Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(moveTo());
        if (launch == null) {
            call.reject("The new app could not be opened.");
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(launch);
        call.resolve();
    }
}
