class_name SuggestionsBanner
extends MarginContainer

signal open_scenario(scenario_id: String)

const BANNER_BG := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.1)
const BANNER_BORDER := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.3)
const BADGE_BG := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.22)
const BADGE_BORDER := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.55)

var engine: EngineLink
var rows: Array = []
var _panel: PanelContainer


func _init() -> void:
	add_theme_constant_override("margin_bottom", 16)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_panel = CommunityKit.panel(BANNER_BG, BANNER_BORDER, 16, Vector4(14, 11, 14, 11))
	add_child(_panel)
	visible = false


func setup(link: EngineLink) -> void:
	engine = link


func refresh(check := true) -> void:
	var reply := await engine.request("community.suggestions.check" if check else "community.suggestions.summary")
	if not is_instance_valid(self):
		return
	rows = (reply["result"] as Dictionary).get("rows", []) if reply.get("ok", false) else []
	_render()


func count_for(scenario_id: String) -> int:
	for entry in rows:
		if str((entry as Dictionary).get("id", "")) == scenario_id:
			return int((entry as Dictionary).get("count", 0))
	return 0


func _render() -> void:
	for child in _panel.get_children():
		_panel.remove_child(child)
		child.queue_free()
	visible = not rows.is_empty()
	if rows.is_empty():
		return
	var line := CommunityKit.flow(10, 8)
	var lead := UI.label("💬 People have suggested changes to your scenarios", 14, Color(1, 1, 1), 700)
	lead.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	lead.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(lead)
	for entry in rows:
		var row: Dictionary = entry
		var count := int(row.get("count", 0))
		var name := str(row.get("name", ""))
		var button := CommunityDialog.button("%s: 1 suggestion" % name if count == 1 else "%s: %d suggestions" % [name, count])
		var id := str(row.get("id", ""))
		button.pressed.connect(func() -> void: open_scenario.emit(id))
		line.add_child(button)
	_panel.add_child(line)


static func count_badge(count: int) -> Button:
	if count <= 0:
		return null
	var badge := CommunityKit.pill_button("💬 1 suggestion" if count == 1 else "💬 %d suggestions" % count, {
		"bg": BADGE_BG,
		"border": BADGE_BORDER,
		"ink": Color(1, 1, 1),
		"size": 11,
		"weight": 700,
		"height": 26.0,
		"pad": 10.0,
		"radius": 999,
	})
	badge.tooltip_text = "People have suggested changes to this scenario"
	return badge
