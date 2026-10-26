class_name WorkshopReference
extends WorkshopShell

var host: Workshop


func _init() -> void:
	super._init("Reference image", "image", 280.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	var upload := WorkshopUI.pill("⬆ Upload reference image")
	upload.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	UI.set_disabled_look(upload, "A reference image to trace over is not in the native Workshop yet: this app's map cannot lay a picture over the regions.")
	body.add_child(upload)
	fit()
