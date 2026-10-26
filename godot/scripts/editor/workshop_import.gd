class_name WorkshopImport
extends WorkshopShell

var host: Workshop


func _init() -> void:
	super._init("Import Map", "upload", 360.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	body.add_child(WorkshopUI.wrap("Replace this map's regions with a province map: a GeoJSON file or a picture of coloured provinces.", 12, Color(1, 1, 1, 0.6)))
	var choose := WorkshopUI.pill("Choose a province map…", true)
	choose.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	UI.set_disabled_look(choose, "Importing a province map is not in the native Workshop yet: it reads province pictures with the browser's canvas, which the native app does not have.")
	body.add_child(choose)
	fit()
