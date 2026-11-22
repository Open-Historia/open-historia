/*! Open Historia — the app takes the games its earlier id hands it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
package io.github.arkniem.openhistoria;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.ProgressBar;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

// Where the handover build (SaveMovePlugin.send, the app under its earlier id)
// hands over the player's games and settings: one file, packed by the page
// (src/runtime/web/saveMove.js), read through a content:// address of the
// sender's own FileProvider that it granted this app.
//
// Exported, since another app has to start it, so anybody can try. It takes
// the file only from an app that started it for a result (that is what makes
// Android say who is calling: getCallingPackage) and that is signed with this
// app's own key, from that app's own provider, and only when the file begins
// as a packed library does. Anything else is turned away with nothing read.
// The handover build takes nothing: games only ever move to the app.
//
// The copy goes to files/save-move/incoming.ohmv. The game is opened (or, if it
// is running, told) and its page merges the file before it reads the library
// (src/runtime/native/appMove.js takeMovedSaves), then deletes it.
public class SaveMoveActivity extends Activity {
    private static final String TAG = "OpenHistoria";
    static final String ACTION_SAVES_ARRIVED = "io.github.arkniem.openhistoria.action.SAVES_ARRIVED";
    private static final byte[] MAGIC = "OHMV1\n".getBytes(StandardCharsets.US_ASCII);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri uri = getIntent() != null ? getIntent().getData() : null;
        String refusal = refusal(getCallingPackage(), uri);
        if (refusal != null) {
            Log.w(TAG, "Saves offered to this app were refused: " + refusal);
            setResult(RESULT_CANCELED);
            finish();
            return;
        }
        // Only a spinner: a big library takes a few seconds to copy.
        FrameLayout frame = new FrameLayout(this);
        frame.addView(new ProgressBar(this), new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        setContentView(frame);
        Thread copy = new Thread(() -> {
            boolean kept = keep(uri);
            runOnUiThread(() -> {
                if (kept) {
                    setResult(RESULT_OK);
                    Intent game = new Intent(this, MainActivity.class);
                    game.setAction(ACTION_SAVES_ARRIVED);
                    game.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(game);
                } else {
                    setResult(RESULT_CANCELED);
                }
                finish();
            });
        }, "oh-save-move");
        copy.start();
    }

    // Why the offer is turned away, or null to take it.
    private String refusal(String caller, Uri uri) {
        String moveTo = BuildConfig.OH_MOVE_TO;
        if (moveTo != null && !moveTo.isEmpty()) return "this is the handover build";
        if (caller == null) return "the sender did not ask for an answer, so it cannot be told apart";
        if (caller.equals(getPackageName())) return "it came from this app";
        PackageManager packages = getPackageManager();
        if (packages.checkSignatures(caller, getPackageName()) != PackageManager.SIGNATURE_MATCH) {
            return caller + " is not signed with this app's key";
        }
        if (uri == null || !"content".equals(uri.getScheme()) || uri.getAuthority() == null) return "no content address";
        ProviderInfo provider = packages.resolveContentProvider(uri.getAuthority(), 0);
        if (provider == null || !caller.equals(provider.packageName)) return "the file is not the sender's own";
        return null;
    }

    // Copies the file beside the app's other files, whole or not at all.
    private boolean keep(Uri uri) {
        File folder = new File(getFilesDir(), SaveMovePlugin.FOLDER);
        File part = new File(folder, SaveMovePlugin.INCOMING + ".part");
        File target = SaveMovePlugin.incomingFile(this);
        if (!folder.isDirectory() && !folder.mkdirs()) return false;
        try (InputStream in = getContentResolver().openInputStream(uri);
             OutputStream out = new FileOutputStream(part)) {
            if (in == null) throw new IOException("nothing to read");
            byte[] head = new byte[MAGIC.length];
            int got = 0;
            while (got < head.length) {
                int read = in.read(head, got, head.length - got);
                if (read < 0) break;
                got += read;
            }
            if (got != head.length || !Arrays.equals(head, MAGIC)) throw new IOException("not a packed library");
            out.write(head);
            byte[] buffer = new byte[256 * 1024];
            int read;
            long total = head.length;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
                total += read;
            }
            out.flush();
            target.delete();
            if (!part.renameTo(target)) throw new IOException("the copy could not be kept");
            Log.i(TAG, "Saves from the earlier app kept (" + total + " bytes); the game merges them as it starts.");
            return true;
        } catch (Exception error) {
            part.delete();
            Log.w(TAG, "Saves from the earlier app could not be copied: " + error);
            return false;
        }
    }
}
