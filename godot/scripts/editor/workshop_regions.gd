class_name WorkshopRegions
extends WorkshopShell

var host: Workshop
var _query := ""
var _count_label: Label
var _list: VBoxContainer
var _serial := 0


func _init() -> void:
	super._init("Regions", "list", 330.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	row.add_child(WorkshopUI.icon_rect("search", 15, Color(1, 1, 1, 0.6)))
	var search := WorkshopUI.input("", "Search name, code, owner…", func(text: String) -> void:
		_query = text
		_reload(), 13.6, 32.0)
	row.add_child(search)
	body.add_child(row)
	search.grab_focus.call_deferred()
	_count_label = UI.label("", 11, Color(1, 1, 1, 0.5))
	body.add_child(_count_label)
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 3)
	body.add_child(_list)
	host.changed.connect(func(parts: Dictionary) -> void:
		if parts.has("regions") or parts.has("selection") or parts.has("doc"):
			_reload())
	await _reload()


func _reload() -> void:
	_serial += 1
	var serial := _serial
	var reply := await host.request_raw("workshop.queryRegions", {"text": _query, "limit": 300})
	if serial != _serial or not reply.get("ok", false):
		return
	var results: Array = (reply["result"] as Dictionary).get("results", [])
	_count_label.text = "%d%s shown" % [results.size(), "+" if results.size() >= 300 else ""]
	WorkshopUI.clear(_list)
	var selected := {}
	for id in host.selection:
		selected[str(id)] = true
	for result in results:
		var entry: Dictionary = result
		var id := str(entry.get("id", ""))
		var active := selected.has(id)
		var parts := WorkshopUI.card(8, Color(0, 0, 0, 0.25) if active else Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.28) if active else Color(0, 0, 0, 0), Vector4(8, 6, 8, 6), 1)
		var card: PanelContainer = parts[0]
		var inner: VBoxContainer = parts[1]
		var name := str(entry.get("name", ""))
		var title := UI.label(name if not name.is_empty() else "Region", 13, Color(1, 1, 1), 600)
		title.clip_text = true
		title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		inner.add_child(title)
		var owner_name := str(entry.get("ownerName", ""))
		inner.add_child(UI.label(owner_name if not owner_name.is_empty() else "unowned", 11, Color(1, 1, 1, 0.5)))
		WorkshopUI.ignore_mouse(card)
		WorkshopUI.clickable(card, func(_event: InputEventMouseButton) -> void:
			host.set_selection([id])
			host.zoom_to([id]))
		_list.add_child(card)
	fit()
