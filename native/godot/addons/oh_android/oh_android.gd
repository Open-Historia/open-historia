@tool
extends EditorPlugin

var _export: EditorExportPlugin


func _enter_tree() -> void:
	_export = AndroidExport.new()
	add_export_plugin(_export)


func _exit_tree() -> void:
	if _export:
		remove_export_plugin(_export)
	_export = null


class AndroidExport extends EditorExportPlugin:
	func _get_name() -> String:
		return "OpenHistoriaAndroid"

	func _supports_platform(platform: EditorExportPlatform) -> bool:
		return platform is EditorExportPlatformAndroid

	func _get_android_libraries(_platform: EditorExportPlatform, _debug: bool) -> PackedStringArray:
		var library := ProjectSettings.globalize_path("res://").path_join("../android/out/plugin/oh-android.aar").simplify_path()
		if not FileAccess.file_exists(library):
			push_error("The Open Historia Android library is missing: build it with native/android/build.mjs (%s)." % library)
			return PackedStringArray()
		return PackedStringArray([library])
