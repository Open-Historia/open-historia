class_name WarRoomStore
extends RefCounted

signal changed(keys: PackedStringArray)
signal way_drawn(tool: String, way: Array, extra: Dictionary)

const TOOLS := ["pan", "select", "route", "diversion", "replan", "transport", "fortify", "fleet", "deploy"]
const CLOSED := {
	"open": false,
	"battlefield": "",
	"side": -1,
	"tool": "pan",
	"selected": [],
	"highlight": -1,
	"replan": "",
	"medium": "",
	"deploy_form": "front",
	"deploy_count": "",
	"draft": null,
	"level": 5,
	"fleets": false,
	"fleet": "",
	"station": "",
	"transport_ways": null,
	"pointed": "",
	"plans": [],
	"known": [],
	"cover": 0,
	"rail": 0,
	"fit": 0,
	"supply": false,
	"supply_shade": null,
	"rehearsal_shade": null,
}

var state := CLOSED.duplicate(true)


func value(key: String) -> Variant:
	return state.get(key)


func set_values(patch: Dictionary) -> void:
	var touched := PackedStringArray()
	for key in patch.keys():
		var name := str(key)
		if not CLOSED.has(name):
			continue
		var next: Variant = patch[key]
		var before: Variant = state.get(name)
		if typeof(before) == typeof(next) and before == next:
			continue
		state[name] = (next as Array).duplicate() if next is Array else next
		touched.append(name)
	if not touched.is_empty():
		changed.emit(touched)


func open_room(battlefield: String, side: int) -> void:
	set_values({"open": true, "battlefield": battlefield, "side": side, "tool": "pan", "selected": [], "highlight": -1, "replan": "", "pointed": "", "fit": int(state["fit"]) + 1})


func close_room() -> void:
	var touched := PackedStringArray()
	for key in CLOSED.keys():
		var before: Variant = state.get(key)
		var next: Variant = CLOSED[key]
		if typeof(before) != typeof(next) or before != next:
			touched.append(str(key))
	state = CLOSED.duplicate(true)
	if not touched.is_empty():
		changed.emit(touched)


func show_battlefield(battlefield: String, side: int) -> void:
	if str(state["battlefield"]) == battlefield and int(state["side"]) == side:
		return
	set_values({"battlefield": battlefield, "side": side, "tool": "pan", "selected": [], "highlight": -1, "replan": "", "pointed": "", "plans": [], "known": [], "rehearsal_shade": null, "fit": int(state["fit"]) + 1})


func take_tool(tool: String, extra := {}) -> void:
	if not tool in TOOLS:
		return
	var replan := str(extra.get("replan", ""))
	var medium := str(extra.get("medium", ""))
	var station := str(extra.get("station", ""))
	var current := str(state["tool"])
	var same := current == tool and (tool != "replan" or str(state["replan"]) == replan) and (tool != "transport" or str(state["medium"]) == medium) and (tool != "fleet" or str(state["station"]) == station)
	set_values({
		"tool": "pan" if same else tool,
		"replan": replan if not same and tool == "replan" else "",
		"medium": medium if not same and tool == "transport" else "",
		"station": station if not same and tool == "fleet" else "",
	})


func report_way(tool: String, way: Array, extra := {}) -> void:
	way_drawn.emit(tool, way, extra)
