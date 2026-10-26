class_name WorkshopImport
extends WorkshopShell

const REASON := "The Province Map Importer is not in the native Workshop yet: it decodes province pictures and joins region files in the browser, which the native app does not have."

var host: Workshop


func _init() -> void:
	super._init("🗺 Province Map Importer", "", 460.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	var modes := HBoxContainer.new()
	modes.add_theme_constant_override("separation", 7)
	var raster := WorkshopUI.pill("Province raster", true)
	UI.set_disabled_look(raster, REASON)
	modes.add_child(raster)
	var geojson := WorkshopUI.pill("Region GeoJSON + metadata")
	UI.set_disabled_look(geojson, REASON)
	modes.add_child(geojson)
	body.add_child(modes)
	body.add_child(UI.label("Province image", 12, Color(1, 1, 1), 700))
	var choose := WorkshopUI.pill("Choose file…")
	choose.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	UI.set_disabled_look(choose, REASON)
	body.add_child(choose)
	body.add_child(WorkshopUI.wrap("24/32-bit BMP is decoded directly. PNG/JPEG/WebP use the browser image decoder.", 11.5, Color(1, 1, 1, 0.5)))
	fit()
