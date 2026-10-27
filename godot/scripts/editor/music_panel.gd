class_name EditorMusicPanel
extends VBoxContainer

signal details_changed(details: Dictionary)
signal value_changed(value: Variant)

const SITUATIONS := ["loading", "game", "atWar", "battle"]
const SITUATION_LABELS := {
	"loading": "While the game opens",
	"game": "In the game",
	"atWar": "At war",
	"battle": "In the war room",
}
const DEFAULT_VOLUMES := {"loading": 100, "game": 50, "atWar": 50, "battle": 75}
const MAX_TRACKS := 12
const PICKER_ROWS := 200
const TAG_KINDS := ["genres", "moods", "instruments"]
const TAG_TEXTS := {
	"genres": {"label": "Genre", "any": "Any genre"},
	"moods": {"label": "Mood", "any": "Any mood"},
	"instruments": {"label": "Instrument", "any": "Any instrument"},
}
const HOLD_REASON := "editor-music-preview"
const QUIET := Color(1, 1, 1, 0.58)
const ROW_BG := Color(1, 1, 1, 0.03)
const ROW_BORDER := Color(1, 1, 1, 0.07)
const CHEVRON_UP := "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 15l6-6 6 6'/></svg>"
const CHEVRON_DOWN := "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>"
const PLAY := "<svg viewBox='0 0 24 24'><path d='M7 4l13 8-13 8z' fill='currentColor'/></svg>"
const STOP := "<svg viewBox='0 0 24 24'><path d='M6 5h12v14H6z' fill='currentColor'/></svg>"

var engine: EngineLink
var props := {}
var _music: Variant = null
var _volumes := {}
var _credits: Array = []
var _list: Variant = null
var _by_id := {}
var _adding := ""
var _query := ""
var _tags := {"genres": "", "moods": "", "instruments": ""}
var _write_turn := 0
var _playing_id := ""
var _failed_id := ""
var _preview_turn := 0
var _player: AudioStreamPlayer
var _held := false
var _cards := {}
var _intro: VBoxContainer
var _credits_holder: VBoxContainer
var _picker_list: VBoxContainer
var _picker_notes: VBoxContainer
var _picker_filters: HFlowContainer


func _init() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 15)


func setup(link: EngineLink, next_props: Dictionary) -> void:
	engine = link
	props = next_props
	_player = AudioStreamPlayer.new()
	add_child(_player)
	_player.finished.connect(func() -> void: _finish_preview(_preview_turn))
	_music = props.get("value")
	_volumes = _volumes_of(_music)
	_render()
	var known := await engine.request("editor.music.list", {"known": true})
	if known.get("ok", false) and known.get("result") is Dictionary:
		_take_list(known["result"])
	var fetched := await engine.request("editor.music.list", {})
	if not is_instance_valid(self):
		return
	if fetched.get("ok", false) and fetched.get("result") is Dictionary:
		_take_list(fetched["result"])
	else:
		_take_list({"listed": false, "tracks": [], "unread": "The hub's music list cannot be read yet."})
	_write_view(_record(), false)


func update_props(next_props: Dictionary) -> void:
	props = next_props


func _exit_tree() -> void:
	_preview_turn += 1
	if _player:
		_player.stop()
	_hold(false)


func _take_list(view: Dictionary) -> void:
	_list = view
	_by_id = {}
	for track in view.get("tracks", []):
		if track is Dictionary:
			_by_id[str(track.get("id", ""))] = track
	_render()


func _listed() -> bool:
	return _list is Dictionary and bool((_list as Dictionary).get("listed", false))


func _volumes_of(music: Variant) -> Dictionary:
	var set_volumes: Dictionary = {}
	if music is Dictionary and (music as Dictionary).get("volume") is Dictionary:
		set_volumes = (music as Dictionary)["volume"]
	var out := {}
	for situation in SITUATIONS:
		out[situation] = int(set_volumes.get(situation, DEFAULT_VOLUMES[situation]))
	return out


func _entries_of(situation: String) -> Array:
	if _music is Dictionary and (_music as Dictionary).get(situation) is Array:
		return (_music as Dictionary)[situation]
	return []


func _record() -> Dictionary:
	var record := {}
	for situation in SITUATIONS:
		record[situation] = _entries_of(situation).duplicate(true)
	record["volume"] = _volumes.duplicate()
	return record


func _write(situation: String, entries: Array) -> void:
	var record := _record()
	record[situation] = entries
	_write_view(record, true)


func _write_volume(situation: String, value: int) -> void:
	var record := _record()
	var volume: Dictionary = record["volume"]
	volume[situation] = value
	_volumes[situation] = value
	_write_view(record, true, situation)


func _write_view(record: Dictionary, emit: bool, volume_only := "") -> void:
	_write_turn += 1
	var turn := _write_turn
	var reply := await engine.request("editor.music.view", {"record": record})
	if not is_instance_valid(self) or turn != _write_turn or not reply.get("ok", false):
		return
	var view: Dictionary = reply["result"]
	_music = view.get("music")
	_volumes = view.get("volumes", _volumes_of(_music))
	_credits = view.get("credits", [])
	if emit:
		value_changed.emit(_music)
	if volume_only.is_empty():
		_render()
	else:
		_refresh_volume(volume_only)
		_render_credits()


func _hold(held: bool) -> void:
	if _held == held or engine == null:
		return
	_held = held
	engine.request("audio.hold", {"reason": HOLD_REASON, "held": held})


func _finish_preview(turn: int, failed := "") -> void:
	if turn != _preview_turn:
		return
	_preview_turn += 1
	_player.stop()
	_playing_id = ""
	if not failed.is_empty():
		_failed_id = failed
	_hold(false)
	_render_picker_list()


func _stop_preview() -> void:
	_finish_preview(_preview_turn)


func _play_preview(track: Dictionary) -> void:
	_preview_turn += 1
	var turn := _preview_turn
	var id := str(track.get("id", ""))
	_failed_id = ""
	_player.stop()
	_playing_id = id
	_hold(true)
	_render_picker_list()
	var reply := await engine.request("editor.music.preview", {"id": id})
	if not is_instance_valid(self) or turn != _preview_turn:
		return
	var file := str(reply.get("result", {}).get("file", "")) if reply.get("ok", false) else ""
	if file.is_empty():
		_finish_preview(turn, id)
		return
	var stream := _stream_for(file)
	if stream == null:
		_finish_preview(turn, id)
		return
	_player.stream = stream
	var volume := float(reply["result"].get("volume", 0.25))
	_player.volume_db = linear_to_db(maxf(0.0001, volume))
	_player.play()


func _stream_for(file: String) -> AudioStream:
	var bytes := FileAccess.get_file_as_bytes(file)
	if bytes.is_empty():
		return null
	if bytes.size() >= 4 and bytes.slice(0, 4).get_string_from_ascii() == "OggS":
		return AudioStreamOggVorbis.load_from_buffer(bytes)
	var mp3 := AudioStreamMP3.new()
	mp3.data = bytes
	if mp3.get_length() <= 0.0:
		return null
	return mp3


func _toggle_preview(track: Dictionary) -> void:
	if _playing_id == str(track.get("id", "")):
		_stop_preview()
	else:
		_play_preview(track)


func _open_picker(situation: String) -> void:
	_stop_preview()
	_adding = situation
	_query = ""
	_tags = {"genres": "", "moods": "", "instruments": ""}
	_render()


func _card() -> Array:
	var parts := EditorKit.soft_card(0, 18)
	return parts


func _quiet(text: String, ink := QUIET, size := 12) -> Label:
	var node := UI.wrapped(text, size, ink, 400)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _button(text: String, size := 12) -> Button:
	var node := EditorKit.button(text, "theme", size)
	node.add_theme_font_override("font", UI.font(700))
	node.custom_minimum_size.y = 32
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
		var box := node.get_theme_stylebox(state) as StyleBoxFlat
		if box:
			var copy := box.duplicate() as StyleBoxFlat
			copy.content_margin_left = 13
			copy.content_margin_right = 13
			node.add_theme_stylebox_override(state, copy)
	return node


func _icon_button(svg: String, tooltip: String, active := false) -> Button:
	var node := _button("")
	node.icon = EditorKit.svg_icon(svg, 12, Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.92) if not active else UI.WHITE)
	node.custom_minimum_size = Vector2(32, 32)
	node.tooltip_text = tooltip
	node.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	if active:
		var style := UI.box(Color(1, 1, 1, 0.2), Color(1, 1, 1, 0.4), 9, 1, Vector4(0, 4, 0, 4))
		for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
			node.add_theme_stylebox_override(state, style)
	else:
		for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
			var box := node.get_theme_stylebox(state) as StyleBoxFlat
			if box:
				var copy := box.duplicate() as StyleBoxFlat
				copy.content_margin_left = 0
				copy.content_margin_right = 0
				node.add_theme_stylebox_override(state, copy)
	return node


func _dim_off(node: Control, off: bool, alpha := 0.55) -> void:
	if node is BaseButton:
		(node as BaseButton).disabled = off
		node.mouse_default_cursor_shape = Control.CURSOR_ARROW if off else Control.CURSOR_POINTING_HAND
	node.modulate = Color(1, 1, 1, alpha if off else 1.0)


func _render() -> void:
	for child in get_children():
		if child != _player:
			remove_child(child)
			child.queue_free()
	_cards = {}
	_picker_list = null
	_picker_notes = null
	_picker_filters = null
	var intro := _card()
	var column: VBoxContainer = intro[1]
	column.add_theme_constant_override("separation", 5)
	column.add_child(UI.label("Music", 15, Color(1, 1, 1, 0.92), 800))
	column.add_child(_quiet("Scenario music comes from the community hub's list, which only its contributors can add to, so that every track is one the hub may share."))
	column.add_child(_quiet("A situation with no tracks plays the game's own music."))
	column.add_child(_quiet("A situation's volume is a share of the volume the player set, for whatever plays there."))
	if _list == null:
		column.add_child(_quiet("Loading the hub's music list…"))
	elif not _listed():
		column.add_child(_quiet(str((_list as Dictionary).get("unread", "The hub's music list cannot be read yet.")), EditorKit.WARN_INK))
	add_child(intro[0])
	for situation in SITUATIONS:
		var parts := _card()
		add_child(parts[0])
		_cards[situation] = {"column": parts[1]}
		_render_situation(situation)
	_credits_holder = VBoxContainer.new()
	_credits_holder.add_theme_constant_override("separation", 0)
	add_child(_credits_holder)
	_render_credits()


func _render_situation(situation: String) -> void:
	var holder: Dictionary = _cards[situation]
	var column: VBoxContainer = holder["column"]
	EditorKit.clear(column)
	column.add_theme_constant_override("separation", 8)
	var entries := _entries_of(situation)
	var full := entries.size() >= MAX_TRACKS
	var head := EditorKit.row(10)
	var title := UI.label(SITUATION_LABELS[situation], 14, Color(1, 1, 1, 0.92), 800)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	head.add_child(UI.label("%d / %d" % [entries.size(), MAX_TRACKS], 12, QUIET))
	column.add_child(head)
	var volume_row := EditorKit.row(9)
	var volume_label := UI.label("Volume", 13, Color(1, 1, 1, 0.78))
	volume_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	volume_row.add_child(volume_label)
	var slider := HSlider.new()
	slider.min_value = 0
	slider.max_value = 100
	slider.step = 5
	slider.value = float(_volumes.get(situation, DEFAULT_VOLUMES[situation]))
	slider.custom_minimum_size = Vector2(144, 20)
	slider.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	slider.focus_mode = Control.FOCUS_NONE
	slider.tooltip_text = "Volume"
	slider.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	slider.add_theme_stylebox_override("slider", UI.box(Color(1, 1, 1, 0.16), Color(0, 0, 0, 0), 3, 0, Vector4(0, 2, 0, 2)))
	slider.add_theme_stylebox_override("grabber_area", UI.box(Color("#d4d4d8"), Color(0, 0, 0, 0), 3, 0, Vector4(0, 2, 0, 2)))
	slider.add_theme_stylebox_override("grabber_area_highlight", UI.box(Color("#e4e4e7"), Color(0, 0, 0, 0), 3, 0, Vector4(0, 2, 0, 2)))
	volume_row.add_child(slider)
	var percent := UI.label("%d%%" % int(_volumes.get(situation, DEFAULT_VOLUMES[situation])), 12, QUIET)
	percent.custom_minimum_size.x = 42
	percent.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	volume_row.add_child(percent)
	var reset := _button("Reset")
	reset.pressed.connect(func() -> void:
		slider.set_value_no_signal(float(DEFAULT_VOLUMES[situation]))
		_write_volume(situation, int(DEFAULT_VOLUMES[situation])))
	volume_row.add_child(reset)
	slider.value_changed.connect(func(value: float) -> void:
		percent.text = "%d%%" % int(value)
		_write_volume(situation, int(value)))
	column.add_child(volume_row)
	holder["slider"] = slider
	holder["percent"] = percent
	holder["reset"] = reset
	_dim_off(reset, int(_volumes.get(situation, 0)) == int(DEFAULT_VOLUMES[situation]), 0.45)
	if entries.is_empty():
		column.add_child(_quiet("No tracks chosen: at war, the tracks chosen for the game play, and with none of those the game's own war music." if situation == "atWar" else "No tracks chosen: the game's own music plays."))
	else:
		var rows := VBoxContainer.new()
		rows.add_theme_constant_override("separation", 6)
		for index in range(entries.size()):
			rows.add_child(_chosen_row(situation, entries, index))
		column.add_child(rows)
	if _adding == situation:
		column.add_child(_picker(situation, full))
	else:
		var add := _button("Add a track")
		add.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		add.pressed.connect(func() -> void: _open_picker(situation))
		_dim_off(add, not _listed() or full)
		column.add_child(add)


func _refresh_volume(situation: String) -> void:
	if not _cards.has(situation):
		return
	var holder: Dictionary = _cards[situation]
	if not holder.has("percent"):
		return
	var value := int(_volumes.get(situation, DEFAULT_VOLUMES[situation]))
	(holder["percent"] as Label).text = "%d%%" % value
	var slider: HSlider = holder["slider"]
	if int(slider.value) != value:
		slider.set_value_no_signal(float(value))
	_dim_off(holder["reset"], value == int(DEFAULT_VOLUMES[situation]), 0.45)


func _row_box() -> Array:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(ROW_BG, ROW_BORDER, 12, 1, Vector4(9, 7, 9, 7)))
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	holder.add_child(row)
	return [holder, row]


func _length_of(seconds: int) -> String:
	if seconds <= 0:
		return ""
	return "%d:%02d" % [seconds / 60, seconds % 60]


func _detail_of(track: Dictionary) -> String:
	var parts: PackedStringArray = []
	for value in [str(track.get("artist", "")), str(track.get("licence", "")), _length_of(int(track.get("seconds", 0)))]:
		if not value.is_empty():
			parts.append(value)
	return " · ".join(parts)


func _tag_line_of(track: Dictionary) -> String:
	var parts: PackedStringArray = []
	var genres: Array = track.get("genres", []) if track.get("genres") is Array else []
	var moods: Array = track.get("moods", []) if track.get("moods") is Array else []
	var genre_text := ", ".join(PackedStringArray(genres.map(func(item: Variant) -> String: return str(item))))
	var mood_text := ", ".join(PackedStringArray(moods.slice(0, 4).map(func(item: Variant) -> String: return str(item))))
	if not genre_text.is_empty():
		parts.append(genre_text)
	if not mood_text.is_empty():
		parts.append(mood_text)
	return " · ".join(parts)


func _name_block(lines: Array) -> VBoxContainer:
	var block := VBoxContainer.new()
	block.add_theme_constant_override("separation", 1)
	block.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for line in lines:
		block.add_child(line)
	return block


func _track_name(text: String) -> Label:
	var node := UI.wrapped(text, 13, UI.WHITE, 700)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _chosen_row(situation: String, entries: Array, index: int) -> Control:
	var parts := _row_box()
	var row: HBoxContainer = parts[1]
	var entry: Dictionary = entries[index] if entries[index] is Dictionary else {}
	var number := UI.label(str(index + 1), 12, QUIET)
	number.custom_minimum_size.x = 18
	number.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(number)
	var track: Variant = _by_id.get(str(entry.get("id", ""))) if _listed() else null
	var there: bool = track is Dictionary and not bool((track as Dictionary).get("removed", false))
	var lines: Array = []
	lines.append(_track_name(str((track as Dictionary).get("name", "")) if there else str(entry.get("id", ""))))
	if there and not _detail_of(track).is_empty():
		lines.append(_quiet(_detail_of(track), QUIET, 12))
	if not there and _listed():
		lines.append(UI.label("No longer on the hub", 12, EditorKit.WARN_INK))
	row.add_child(_name_block(lines))
	var up := _icon_button(CHEVRON_UP, "Move up")
	_dim_off(up, index == 0, 0.4)
	up.pressed.connect(func() -> void: _move(situation, index, -1))
	row.add_child(up)
	var down := _icon_button(CHEVRON_DOWN, "Move down")
	_dim_off(down, index == entries.size() - 1, 0.4)
	down.pressed.connect(func() -> void: _move(situation, index, 1))
	row.add_child(down)
	var remove := _button("Remove")
	remove.pressed.connect(func() -> void:
		var next := entries.duplicate(true)
		next.remove_at(index)
		_write(situation, next))
	row.add_child(remove)
	return parts[0]


func _move(situation: String, index: int, by: int) -> void:
	var entries := _entries_of(situation).duplicate(true)
	var entry: Variant = entries[index]
	entries.remove_at(index)
	entries.insert(index + by, entry)
	_write(situation, entries)


func _offered() -> Array:
	if not _list is Dictionary:
		return []
	var out: Array = []
	for track in (_list as Dictionary).get("tracks", []):
		if track is Dictionary and not bool(track.get("removed", false)) and not str(track.get("file", "")).is_empty():
			out.append(track)
	return out


func _tags_of(track: Dictionary, kind: String) -> Array:
	var value: Variant = track.get(kind)
	return value if value is Array else []


func _with_tags(tracks: Array, wanted: Dictionary) -> Array:
	return tracks.filter(func(track: Dictionary) -> bool:
		for kind in TAG_KINDS:
			var tag := str(wanted.get(kind, ""))
			if not tag.is_empty() and not _tags_of(track, kind).has(tag):
				return false
		return true)


func _tag_counts(tracks: Array, kind: String) -> Array:
	var counts := {}
	var order: Array = []
	for track in tracks:
		for tag in _tags_of(track, kind):
			var key := str(tag)
			if not counts.has(key):
				counts[key] = 0
				order.append(key)
			counts[key] = int(counts[key]) + 1
	var pairs: Array = []
	for key in order:
		pairs.append([key, counts[key]])
	pairs.sort_custom(func(a: Array, b: Array) -> bool:
		if int(a[1]) != int(b[1]):
			return int(a[1]) > int(b[1])
		return str(a[0]).nocasecmp_to(str(b[0])) < 0)
	return pairs


func _searched() -> Array:
	var wanted := _query.strip_edges().to_lower()
	return _offered().filter(func(track: Dictionary) -> bool:
		return wanted.is_empty() or ("%s %s" % [str(track.get("name", "")), str(track.get("artist", ""))]).to_lower().contains(wanted))


func _picker(situation: String, full: bool) -> Control:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 7)
	box.add_child(EditorKit.gap(4))
	box.add_child(EditorKit.rule())
	box.add_child(EditorKit.gap(4))
	var top := EditorKit.row(7)
	var search := EditorKit.line(_query, "Search by name or composer", Callable(), 36)
	search.add_theme_font_size_override("font_size", 13)
	for state in ["normal", "focus"]:
		var style := search.get_theme_stylebox(state) as StyleBoxFlat
		if style:
			var copy := style.duplicate() as StyleBoxFlat
			copy.set_corner_radius_all(10)
			copy.content_margin_left = 10
			copy.content_margin_right = 10
			search.add_theme_stylebox_override(state, copy)
	search.text_changed.connect(func(text: String) -> void:
		_query = text
		_refresh_picker(situation, full))
	top.add_child(search)
	var close := _button("Close")
	close.pressed.connect(func() -> void: _open_picker(""))
	top.add_child(close)
	box.add_child(top)
	_picker_filters = EditorKit.flow(7)
	box.add_child(_picker_filters)
	_picker_notes = VBoxContainer.new()
	_picker_notes.add_theme_constant_override("separation", 4)
	box.add_child(_picker_notes)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.custom_minimum_size.y = 0
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_picker_list = VBoxContainer.new()
	_picker_list.add_theme_constant_override("separation", 6)
	_picker_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_picker_list)
	_picker_list.minimum_size_changed.connect(func() -> void:
		if is_instance_valid(scroll) and is_instance_valid(_picker_list):
			scroll.custom_minimum_size.y = minf(288.0, _picker_list.get_combined_minimum_size().y))
	box.add_child(scroll)
	box.set_meta("situation", situation)
	box.set_meta("full", full)
	_refresh_picker.call_deferred(situation, full)
	return box


func _refresh_picker(situation: String, full: bool) -> void:
	if _picker_filters == null or not is_instance_valid(_picker_filters):
		return
	var offered := _offered()
	var searched := _searched()
	EditorKit.clear(_picker_filters)
	var sorted := offered.any(func(track: Dictionary) -> bool:
		for kind in TAG_KINDS:
			if not _tags_of(track, kind).is_empty():
				return true
		return false)
	var narrowed := false
	for kind in TAG_KINDS:
		if not str(_tags[kind]).is_empty():
			narrowed = true
	if sorted:
		for kind in TAG_KINDS:
			var others := _tags.duplicate()
			others[kind] = ""
			var choices := _tag_counts(_with_tags(searched, others), kind)
			var options: Array = []
			var current := str(_tags[kind])
			var present := false
			for pair in choices:
				if str(pair[0]) == current:
					present = true
			if not current.is_empty() and not present:
				options.append([current, current])
			for pair in choices:
				options.append([str(pair[0]), "%s (%d)" % [str(pair[0]), int(pair[1])]])
			var select := EditorKit.select(options, current, func(value: String) -> void:
				_tags[kind] = value
				_refresh_picker(situation, full), TAG_TEXTS[kind]["any"])
			select.custom_minimum_size = Vector2(144, 36)
			select.add_theme_font_size_override("font_size", 13)
			select.tooltip_text = TAG_TEXTS[kind]["label"]
			select.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			_picker_filters.add_child(select)
		if narrowed:
			var clear := _button("Clear filters")
			clear.pressed.connect(func() -> void:
				_tags = {"genres": "", "moods": "", "instruments": ""}
				_refresh_picker(situation, full))
			_picker_filters.add_child(clear)
	_picker_filters.visible = sorted
	EditorKit.clear(_picker_notes)
	var tracks := _picker_tracks(situation)
	if full:
		_picker_notes.add_child(_quiet("A situation holds at most 12 tracks.", EditorKit.WARN_INK))
	if offered.is_empty():
		_picker_notes.add_child(_quiet("The hub's music list has no tracks yet."))
	elif tracks.is_empty():
		_picker_notes.add_child(_quiet("No track matches the search and filters." if narrowed else "No track matches the search."))
	_picker_notes.visible = _picker_notes.get_child_count() > 0
	_render_picker_list()


func _picker_tracks(situation: String) -> Array:
	var found := _with_tags(_searched(), _tags)
	var fitting := found.filter(func(track: Dictionary) -> bool: return (track.get("fits", []) as Array).has(situation) if track.get("fits") is Array else false)
	var rest := found.filter(func(track: Dictionary) -> bool: return not ((track.get("fits", []) as Array).has(situation) if track.get("fits") is Array else false))
	return fitting + rest


func _render_picker_list() -> void:
	if _picker_list == null or not is_instance_valid(_picker_list):
		return
	var box := _picker_list.get_parent().get_parent()
	var situation := str(box.get_meta("situation", _adding))
	var full := bool(box.get_meta("full", false))
	EditorKit.clear(_picker_list)
	var tracks := _picker_tracks(situation)
	for track in tracks.slice(0, PICKER_ROWS):
		_picker_list.add_child(_picker_row(situation, track, full))
	var more := box.get_node_or_null("More")
	if more:
		box.remove_child(more)
		more.queue_free()
	if tracks.size() > PICKER_ROWS:
		var note := _quiet("Showing the first 200 tracks. Search to find the rest.")
		note.name = "More"
		box.add_child(note)


func _picker_row(situation: String, track: Dictionary, full: bool) -> Control:
	var parts := _row_box()
	var row: HBoxContainer = parts[1]
	var id := str(track.get("id", ""))
	var playing := _playing_id == id
	var play := _icon_button(STOP if playing else PLAY, "Stop the preview" if playing else "Play a preview", playing)
	play.pressed.connect(func() -> void: _toggle_preview(track))
	row.add_child(play)
	var lines: Array = [_track_name(str(track.get("name", "")))]
	if not _detail_of(track).is_empty():
		lines.append(_quiet(_detail_of(track), QUIET, 12))
	if not _tag_line_of(track).is_empty():
		lines.append(_quiet(_tag_line_of(track), QUIET, 12))
	if _failed_id == id:
		lines.append(UI.label("This track could not be played.", 12, Color("#fecaca")))
	row.add_child(_name_block(lines))
	var add := EditorKit.button("Add", "theme", 12)
	add.add_theme_font_override("font", UI.font(700))
	add.custom_minimum_size.y = 32
	var style := UI.box(Color(1, 1, 1, 0.14), Color(1, 1, 1, 0.3), 9, 1, Vector4(13, 4, 13, 4))
	var hover := UI.box(Color(1, 1, 1, 0.19), Color(1, 1, 1, 0.4), 9, 1, Vector4(13, 4, 13, 4))
	for state in [["normal", style], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", style], ["disabled", style]]:
		add.add_theme_stylebox_override(state[0], state[1])
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		add.add_theme_color_override(name, UI.WHITE)
	_dim_off(add, full)
	add.pressed.connect(func() -> void:
		var entries := _entries_of(situation).duplicate(true)
		entries.append({"id": id, "version": track.get("version", 1)})
		_write(situation, entries))
	row.add_child(add)
	return parts[0]


func _render_credits() -> void:
	if _credits_holder == null or not is_instance_valid(_credits_holder):
		return
	EditorKit.clear(_credits_holder)
	if _credits.is_empty():
		return
	var parts := _card()
	var column: VBoxContainer = parts[1]
	column.add_theme_constant_override("separation", 2)
	column.add_child(_quiet("Music:"))
	for entry in _credits:
		if not entry is Dictionary:
			continue
		var line := RichTextLabel.new()
		line.bbcode_enabled = true
		line.fit_content = true
		line.scroll_active = false
		line.autowrap_mode = TextServer.AUTOWRAP_ARBITRARY
		line.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		line.add_theme_font_override("normal_font", UI.font(400))
		line.add_theme_font_size_override("normal_font_size", 12)
		line.add_theme_color_override("default_color", QUIET)
		var text := str(entry.get("credit", "")).replace("[", "[lb]")
		var site := str(entry.get("site", ""))
		if not site.is_empty():
			text += " [url=%s][u]%s[/u][/url]" % [str(entry.get("source", "")).replace("]", "%5D"), site.replace("[", "[lb]")]
		line.text = text
		line.meta_clicked.connect(func(meta: Variant) -> void: OS.shell_open(str(meta)))
		column.add_child(line)
	_credits_holder.add_child(parts[0])
