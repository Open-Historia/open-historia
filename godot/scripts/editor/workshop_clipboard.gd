class_name WorkshopClipboard
extends WorkshopShell

var host: Workshop
var _summary: Variant = null
var _result: Variant = null
var _simplify := true


func _init() -> void:
	super._init("Clipboard", "copy", 340.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	host.changed.connect(func(parts: Dictionary) -> void:
		if parts.has("selection"):
			_render())
	var reply := await host.request_raw("workshop.clipboard")
	if reply.get("ok", false):
		_summary = (reply["result"] as Dictionary).get("summary")
	_render()


func _plural(count: int, word: String) -> String:
	return "%d %s%s" % [count, word, "" if count == 1 else "s"]


func _ago(iso: String) -> String:
	var then := Time.get_unix_time_from_datetime_string(iso) if not iso.is_empty() else 0.0
	if then <= 0.0:
		return ""
	var minutes := int(round((Time.get_unix_time_from_system() - then) / 60.0))
	if minutes < 1:
		return "just now"
	if minutes < 60:
		return "%d min ago" % minutes
	var hours := int(round(float(minutes) / 60.0))
	if hours < 24:
		return "%s ago" % _plural(hours, "hour")
	var date := Time.get_datetime_dict_from_unix_time(int(then))
	var months := ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
	return "%s %d, %d" % [months[int(date["month"]) - 1], int(date["day"]), int(date["year"])]


func _render() -> void:
	clear_body()
	var count := host.selection.size()
	if count > 0:
		var copy := WorkshopUI.pill("Copy %s" % _plural(count, "selected region"))
		copy.icon = WorkshopUI.icon("copy", 14)
		copy.tooltip_text = "Copy the selected regions to the clipboard (Ctrl+C)"
		copy.pressed.connect(func() -> void:
			var reply := await host.request("workshop.clipboard.copy", {"ids": host.selection})
			_result = reply.get("result")
			_summary = reply.get("summary")
			_render())
		body.add_child(copy)
	if _summary is Dictionary:
		var summary: Dictionary = _summary
		var parts := WorkshopUI.card(8, Color(0, 0, 0, 0), Color(1, 1, 1, 0.09), Vector4(10, 8, 10, 8), 4)
		var inner: VBoxContainer = parts[1]
		inner.add_child(UI.label("%s from %s" % [_plural(int(summary.get("count", 0)), "region"), str(summary.get("source", ""))], 13, Color(1, 1, 1), 600))
		inner.add_child(UI.label("copied %s" % _ago(str(summary.get("copiedAt", ""))), 11, Color(1, 1, 1, 0.5)))
		var owners: Array = summary.get("owners", [])
		for index in range(mini(12, owners.size())):
			var owner: Dictionary = owners[index]
			var line := HBoxContainer.new()
			var name := UI.label(str(owner.get("name", "")), 11.5, Color(1, 1, 1, 0.85) if not str(owner.get("key", "")).is_empty() else Color(1, 1, 1, 0.45))
			name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			line.add_child(name)
			line.add_child(UI.label(_plural(int(owner.get("count", 0)), "region"), 11.5, Color(1, 1, 1, 0.5)))
			inner.add_child(line)
		if owners.size() > 12:
			inner.add_child(UI.label("and %d more" % (owners.size() - 12), 11, Color(1, 1, 1, 0.45)))
		body.add_child(parts[0])
		var paste := WorkshopUI.pill("Paste into this map", true)
		paste.icon = WorkshopUI.icon("paint", 14)
		paste.tooltip_text = "Paste these regions into this map, replacing whatever territory they overlap (Ctrl+V)"
		paste.pressed.connect(func() -> void:
			var reply := await host.paste_clipboard(_simplify)
			_result = reply.get("result")
			_render())
		body.add_child(paste)
		body.add_child(WorkshopUI.check("Simplify to this map's detail", _simplify, func(on: bool) -> void: _simplify = on, 11.5))
	else:
		body.add_child(WorkshopUI.wrap("Nothing copied yet. Select regions (click, Shift-click, lasso, or double-click a country) and press Copy to clipboard in the selection panel, or Ctrl+C.", 11.5, Color(1, 1, 1, 0.5)))
	if _result is Dictionary:
		var result: Dictionary = _result
		if str(result.get("kind", "")) == "pasted":
			var added: Array = result.get("added", [])
			var text := "Pasted %s" % _plural(added.size(), "region")
			if int(result.get("trimmed", 0)) > 0:
				text += " · %s underneath trimmed" % _plural(int(result["trimmed"]), "region")
			if int(result.get("removed", 0)) > 0:
				text += " · %s underneath replaced entirely" % _plural(int(result["removed"]), "region")
			text += " — the clipboard had no polygons to paste" if added.is_empty() else "."
			body.add_child(WorkshopUI.wrap(text, 11.5, Color("#e4e4e7")))
		elif str(result.get("kind", "")) == "copied":
			body.add_child(WorkshopUI.wrap("Copied %s. Open the map you are building and paste." % _plural(int(result.get("count", 0)), "region"), 11.5, Color("#e4e4e7")))
	clear_footer()
	if _summary is Dictionary:
		var foot := HBoxContainer.new()
		var label := UI.label("%s from %s" % [_plural(int((_summary as Dictionary).get("count", 0)), "region"), str((_summary as Dictionary).get("source", ""))], 12, Color(1, 1, 1, 0.5))
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		foot.add_child(label)
		var clear := WorkshopUI.danger_pill("Clear")
		clear.pressed.connect(func() -> void:
			await host.request("workshop.clipboard.clear")
			_summary = null
			_result = null
			_render())
		foot.add_child(clear)
		footer.add_child(foot)
	fit()
