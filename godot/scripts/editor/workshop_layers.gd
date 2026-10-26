class_name WorkshopLayers
extends WorkshopShell

const LAYERS := [
	["regions", "Regions"],
	["labels", "Region labels"],
	["groups", "Group outlines"],
	["features", "Cities and map features"],
	["units", "Starting units"],
	["fortifications", "Fortified lines"],
	["freezing", "Water that can freeze"],
]
const UNDRAWN := {
	"groups": "This app's map does not draw group outlines yet: a group's area shows only as its tint.",
	"freezing": "This app's map does not draw the hatch over water that can freeze yet.",
}

var host: Workshop


func _init() -> void:
	super._init("Layers", "layers", 260.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	for entry in LAYERS:
		var key := str(entry[0])
		var toggle := WorkshopUI.toggle(bool(host.map.layers.get(key, true)), func(on: bool) -> void:
			host.map.layers[key] = on
			if key == "regions":
				host.map.set_regions_visible(on)
			host.map.redraw())
		var line := WorkshopUI.row(str(entry[1]), toggle)
		if UNDRAWN.has(key):
			line.tooltip_text = str(UNDRAWN[key])
		body.add_child(line)
	fit()
