class_name DevToolsElements
extends HSplitContainer

signal node_selected(node: Node)

const SHOWN_CHILDREN := 400
const SEARCH_LIMIT := 300
const STUB := -1
const NAME_INK := Color("#7cd3f5")
const LAYOUT := ["position", "size", "global_position", "custom_minimum_size", "rotation_degrees", "scale", "pivot_offset", "size_flags_horizontal", "size_flags_vertical", "anchor_left", "anchor_top", "anchor_right", "anchor_bottom", "mouse_filter", "clip_contents", "focus_mode"]
const TRANSFORM := ["position", "global_position", "rotation_degrees", "scale", "skew"]
const CANVAS := ["visible", "modulate", "self_modulate", "z_index", "z_as_relative", "top_level", "show_behind_parent"]
const CONTENT := ["text", "placeholder_text", "tooltip_text", "disabled", "button_pressed", "editable", "value", "texture"]
const EDITABLE := [TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING, TYPE_STRING_NAME, TYPE_NODE_PATH, TYPE_VECTOR2, TYPE_VECTOR2I, TYPE_VECTOR3, TYPE_VECTOR3I, TYPE_VECTOR4, TYPE_RECT2, TYPE_RECT2I, TYPE_COLOR]
const OVERRIDES := {"theme_override_colors/": "has_theme_color_override", "theme_override_constants/": "has_theme_constant_override", "theme_override_font_sizes/": "has_theme_font_size_override", "theme_override_fonts/": "has_theme_font_override", "theme_override_styles/": "has_theme_stylebox_override", "theme_override_icons/": "has_theme_icon_override"}

var host: DevToolsWindow
var tree: Tree
var search: LineEdit
var found_label: Label
var title_label: Label
var kind_label: Label
var path_field: LineEdit
var props: VBoxContainer
var _selected_id := 0
var _items := {}
var _expanded := {}
var _rows: Array = []
var _query := ""
var _building := false
var _dirty := false
var _show_all := false
var _rebuild_timer: Timer
var _search_timer: Timer
var _live_timer: Timer
var _watching := false


func _init(window: DevToolsWindow) -> void:
	host = window
	name = "Elements"
	split_offset = 560
	add_child(_build_tree_side())
	add_child(_build_props_side())
	_rebuild_timer = _timer(0.6, func() -> void:
		if is_visible_in_tree():
			rebuild())
	_search_timer = _timer(0.22, _run_search)
	_live_timer = _timer(0.5, _update_rows)
	_live_timer.one_shot = false
	visibility_changed.connect(_on_visibility)


func _timer(seconds: float, action: Callable) -> Timer:
	var timer := Timer.new()
	timer.one_shot = true
	timer.wait_time = seconds
	timer.timeout.connect(action)
	add_child(timer)
	return timer


func _build_tree_side() -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.custom_minimum_size.x = 280
	var top := DevToolsStyle.bar()
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	search = DevToolsStyle.field("Find by name, class or /root/path")
	search.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	search.text_changed.connect(func(_text: String) -> void: _search_timer.start())
	search.text_submitted.connect(func(_text: String) -> void: _run_search())
	row.add_child(search)
	found_label = DevToolsStyle.text("", 11, DevToolsStyle.FAINT)
	row.add_child(found_label)
	var refresh := DevToolsStyle.button("Refresh", "Read the scene tree again")
	refresh.pressed.connect(rebuild)
	row.add_child(refresh)
	top.add_child(row)
	column.add_child(top)
	tree = Tree.new()
	tree.columns = 2
	tree.hide_root = false
	tree.select_mode = Tree.SELECT_ROW
	tree.size_flags_vertical = Control.SIZE_EXPAND_FILL
	tree.set_column_expand(0, true)
	tree.set_column_expand(1, false)
	tree.set_column_custom_minimum_width(1, 180)
	tree.set_column_clip_content(0, true)
	tree.set_column_clip_content(1, true)
	tree.add_theme_font_override("font", UI.font(400, DevToolsStyle.MONO))
	tree.add_theme_font_size_override("font_size", 12)
	tree.item_selected.connect(_on_item_selected)
	tree.item_collapsed.connect(_on_item_collapsed)
	tree.gui_input.connect(_on_tree_input)
	tree.mouse_exited.connect(func() -> void: host.highlight.hover_node(null))
	column.add_child(tree)
	return column


func _build_props_side() -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.custom_minimum_size.x = 300
	var top := DevToolsStyle.bar(Vector4(10, 6, 10, 6))
	var head := VBoxContainer.new()
	head.add_theme_constant_override("separation", 3)
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	title_label = DevToolsStyle.text("Nothing selected", 13, DevToolsStyle.INK, 700, true)
	title_label.clip_text = true
	title_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	line.add_child(title_label)
	kind_label = DevToolsStyle.text("", 11, DevToolsStyle.MUTED, 400, true)
	line.add_child(kind_label)
	var all := DevToolsStyle.button("All properties", "Show every property of the node", true)
	all.toggled.connect(func(on: bool) -> void:
		_show_all = on
		_show_properties(selected_node()))
	line.add_child(all)
	head.add_child(line)
	path_field = DevToolsStyle.field("", true)
	path_field.editable = false
	path_field.add_theme_color_override("font_uneditable_color", DevToolsStyle.FAINT)
	head.add_child(path_field)
	top.add_child(head)
	column.add_child(top)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var pad := MarginContainer.new()
	pad.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in ["left", "right", "top", "bottom"]:
		pad.add_theme_constant_override("margin_" + side, 10)
	props = VBoxContainer.new()
	props.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	props.add_theme_constant_override("separation", 3)
	pad.add_child(props)
	scroll.add_child(pad)
	column.add_child(scroll)
	return column


func start() -> void:
	if not _watching:
		_watching = true
		get_tree().node_added.connect(_on_tree_changed)
		get_tree().node_removed.connect(_on_tree_changed)
		get_tree().node_renamed.connect(_on_tree_changed)
	rebuild()
	if is_visible_in_tree():
		_live_timer.start()


func stop() -> void:
	if _watching:
		_watching = false
		get_tree().node_added.disconnect(_on_tree_changed)
		get_tree().node_removed.disconnect(_on_tree_changed)
		get_tree().node_renamed.disconnect(_on_tree_changed)
	_live_timer.stop()
	_rebuild_timer.stop()


func _on_visibility() -> void:
	if not is_inside_tree():
		return
	if is_visible_in_tree():
		if _dirty:
			rebuild()
		_live_timer.start()
	else:
		_live_timer.stop()


func _on_tree_changed(node: Node) -> void:
	if not _watching or host.owns(node):
		return
	_dirty = true
	if _rebuild_timer.is_stopped():
		_rebuild_timer.start()


func selected_node() -> Node:
	return instance_from_id(_selected_id) as Node if _selected_id != 0 else null


func rebuild() -> void:
	_dirty = false
	_building = true
	var scroll := tree.get_scroll()
	tree.clear()
	_items.clear()
	if _query.is_empty():
		var top := _add(null, get_tree().root)
		top.collapsed = false
		found_label.text = ""
	else:
		_build_search()
	var item: TreeItem = _items.get(_selected_id)
	if item:
		item.select(0)
	_building = false
	_restore_scroll.call_deferred(scroll.y)


func _restore_scroll(offset: float) -> void:
	for child in tree.get_children(true):
		if child is VScrollBar:
			(child as VScrollBar).value = offset


func _children(node: Node) -> Array[Node]:
	var out: Array[Node] = []
	for child in node.get_children():
		if not host.owns(child):
			out.append(child)
	return out


static func kind(node: Node) -> String:
	var script := node.get_script() as Script
	var named := str(script.get_global_name()) if script else ""
	if not named.is_empty():
		return "%s · %s" % [named, node.get_class()]
	if script and not script.resource_path.is_empty():
		return "%s · %s" % [node.get_class(), script.resource_path.get_file()]
	return node.get_class()


func _describe(item: TreeItem, node: Node) -> void:
	item.set_text(0, String(node.name))
	item.set_text(1, kind(node))
	item.set_metadata(0, node.get_instance_id())
	item.set_tooltip_text(0, str(node.get_path()))
	item.set_tooltip_text(1, kind(node))
	item.set_custom_color(1, DevToolsStyle.FAINT)
	if node is CanvasItem and not (node as CanvasItem).visible:
		item.set_custom_color(0, DevToolsStyle.FAINT)
	else:
		item.set_custom_color(0, NAME_INK)
	_items[node.get_instance_id()] = item


func _add(parent: TreeItem, node: Node) -> TreeItem:
	var item := tree.create_item(parent)
	_describe(item, node)
	if node.get_child_count() > 0 and not _children(node).is_empty():
		if _expanded.has(node.get_instance_id()):
			_populate(item, node)
			item.collapsed = false
		else:
			var stub := tree.create_item(item)
			stub.set_metadata(0, STUB)
			item.collapsed = true
	return item


func _populate(item: TreeItem, node: Node) -> void:
	for child in item.get_children():
		child.free()
	var kids := _children(node)
	for index in range(mini(kids.size(), SHOWN_CHILDREN)):
		_add(item, kids[index])
	if kids.size() > SHOWN_CHILDREN:
		var more := tree.create_item(item)
		more.set_text(0, "… %d more children" % (kids.size() - SHOWN_CHILDREN))
		more.set_metadata(0, STUB)
		more.set_selectable(0, false)
		more.set_selectable(1, false)
		more.set_custom_color(0, DevToolsStyle.FAINT)


func _on_item_collapsed(item: TreeItem) -> void:
	if _building:
		return
	var id := int(item.get_metadata(0))
	if id <= 0:
		return
	if item.collapsed:
		_expanded.erase(id)
		return
	_expanded[id] = true
	var first := item.get_first_child()
	if first and int(first.get_metadata(0)) == STUB:
		var node := instance_from_id(id) as Node
		if node:
			_building = true
			_populate(item, node)
			_building = false


func _on_item_selected() -> void:
	if _building:
		return
	var item := tree.get_selected()
	var id := int(item.get_metadata(0)) if item else 0
	if id <= 0:
		return
	var node := instance_from_id(id) as Node
	if node:
		_select(node)


func _on_tree_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		var item := tree.get_item_at_position((event as InputEventMouseMotion).position)
		var id := int(item.get_metadata(0)) if item else 0
		host.highlight.hover_node(instance_from_id(id) as Node if id > 0 else null)


func _select(node: Node) -> void:
	_selected_id = node.get_instance_id()
	host.highlight.show_node(node)
	_show_properties(node)
	node_selected.emit(node)


func select_node(node: Node) -> bool:
	if node == null or not is_instance_valid(node) or not node.is_inside_tree() or host.owns(node):
		return false
	if not _query.is_empty():
		search.text = ""
		_query = ""
	var walk := node.get_parent()
	while walk:
		_expanded[walk.get_instance_id()] = true
		walk = walk.get_parent()
	_selected_id = node.get_instance_id()
	rebuild()
	var item: TreeItem = _items.get(_selected_id)
	if item:
		tree.scroll_to_item(item, true)
	_select(node)
	return true


func find(query: String) -> Array[Node]:
	search.text = query
	_run_search()
	return find_nodes(query, SEARCH_LIMIT)


func find_nodes(query: String, limit := SEARCH_LIMIT) -> Array[Node]:
	var hits: Array[Node] = []
	var wanted := query.strip_edges()
	if wanted.is_empty():
		return hits
	if wanted.begins_with("/"):
		var direct := get_tree().root.get_node_or_null(NodePath(wanted))
		if direct and not host.owns(direct):
			hits.append(direct)
		return hits
	var stack: Array[Node] = [get_tree().root]
	while not stack.is_empty() and hits.size() < limit:
		var node: Node = stack.pop_back()
		if String(node.name).containsn(wanted) or kind(node).containsn(wanted):
			hits.append(node)
		var kids := _children(node)
		for index in range(kids.size() - 1, -1, -1):
			stack.append(kids[index])
	return hits


func _run_search() -> void:
	_query = search.text.strip_edges()
	rebuild()


func _build_search() -> void:
	var hits := find_nodes(_query)
	found_label.text = "%d%s found" % [hits.size(), "+" if hits.size() >= SEARCH_LIMIT else ""]
	var root_item := tree.create_item()
	_describe(root_item, get_tree().root)
	for hit in hits:
		var chain: Array[Node] = []
		var walk: Node = hit
		while walk and walk != get_tree().root:
			chain.push_front(walk)
			walk = walk.get_parent()
		var parent := root_item
		for node in chain:
			var item: TreeItem = _items.get(node.get_instance_id())
			if item == null:
				item = tree.create_item(parent)
				_describe(item, node)
			parent = item
		var shown: TreeItem = _items.get(hit.get_instance_id())
		if shown:
			shown.set_custom_color(0, DevToolsStyle.ACCENT)
			shown.set_custom_bg_color(0, DevToolsStyle.SELECT.darkened(0.5))


func _show_properties(node: Node) -> void:
	_rows.clear()
	for child in props.get_children():
		props.remove_child(child)
		child.queue_free()
	if node == null or not is_instance_valid(node):
		title_label.text = "Nothing selected"
		kind_label.text = ""
		path_field.text = ""
		return
	title_label.text = String(node.name)
	kind_label.text = kind(node)
	path_field.text = str(node.get_path())
	var lookup := {}
	var listed := node.get_property_list()
	for prop in listed:
		lookup[str(prop["name"])] = prop
	var section := _section("Node")
	_row(section, node, lookup.get("name", {"name": "name", "type": TYPE_STRING_NAME}))
	_fixed(section, "class", node.get_class())
	_fixed(section, "children", str(node.get_child_count()))
	var groups := PackedStringArray()
	for group in node.get_groups():
		if not String(group).begins_with("_"):
			groups.append(String(group))
	if not groups.is_empty():
		_fixed(section, "groups", ", ".join(groups))
	_named(section, node, lookup, ["process_mode", "unique_name_in_owner"])
	var content := _section("Content")
	if _named(content, node, lookup, CONTENT, true) == 0:
		props.remove_child(content)
		content.queue_free()
	if node is Control:
		_named(_section("Layout"), node, lookup, LAYOUT)
	elif node is Node2D or node is Node3D:
		_named(_section("Transform"), node, lookup, TRANSFORM)
	if node is CanvasItem:
		_named(_section("Visibility"), node, lookup, CANVAS)
	if node is Control:
		_overrides(_section("Theme overrides"), node as Control, listed)
	_script_vars(node, listed)
	if _show_all:
		var everything := _section("All properties")
		var count := 0
		for prop in listed:
			if int(prop["usage"]) & PROPERTY_USAGE_EDITOR and int(prop["type"]) != TYPE_NIL and count < 500:
				_row(everything, node, prop)
				count += 1


func _section(title: String) -> VBoxContainer:
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 1)
	var head := DevToolsStyle.text(title, 11, DevToolsStyle.MUTED, 700)
	head.custom_minimum_size.y = 26
	head.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
	holder.add_child(head)
	holder.add_child(DevToolsStyle.divider(false))
	props.add_child(holder)
	return holder


func _named(section: VBoxContainer, node: Node, lookup: Dictionary, names: Array, quiet := false) -> int:
	var count := 0
	for key in names:
		if lookup.has(key):
			_row(section, node, lookup[key])
			count += 1
	if count == 0 and not quiet:
		section.add_child(DevToolsStyle.text("None", 12, DevToolsStyle.FAINT))
	return count


func _fixed(section: VBoxContainer, key: String, value: String) -> void:
	var row := _row_shell(section, key)
	var shown := DevToolsStyle.text(value, 12, DevToolsStyle.MUTED, 400, true)
	shown.clip_text = true
	shown.tooltip_text = value
	shown.mouse_filter = Control.MOUSE_FILTER_PASS
	shown.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(shown)


func _row_shell(section: VBoxContainer, key: String, tag := "") -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	row.custom_minimum_size.y = 24
	var label := DevToolsStyle.text(key, 12, NAME_INK, 400, true)
	label.custom_minimum_size.x = 190
	label.clip_text = true
	label.tooltip_text = key
	label.mouse_filter = Control.MOUSE_FILTER_PASS
	row.add_child(label)
	if not tag.is_empty():
		var badge := UI.pill(tag, DevToolsStyle.SELECT, Color(0, 0, 0, 0), DevToolsStyle.ACCENT, false, 10)
		badge.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(badge)
	section.add_child(row)
	return row


func _row(section: VBoxContainer, node: Node, prop: Dictionary, label := "", tag := "") -> void:
	var key := str(prop.get("name", ""))
	var type := int(prop.get("type", TYPE_NIL))
	var row := _row_shell(section, label if not label.is_empty() else key, tag)
	row.name = "Prop_" + key.replace("/", "_")
	var id := node.get_instance_id()
	var update := Callable()
	var editor: Control
	if type == TYPE_BOOL:
		var box := CheckBox.new()
		box.focus_mode = Control.FOCUS_NONE
		box.button_pressed = bool(node.get(key))
		box.toggled.connect(func(on: bool) -> void: commit(id, key, on))
		update = func() -> void:
			var current := instance_from_id(id) as Node
			if current:
				box.set_pressed_no_signal(bool(current.get(key)))
		editor = box
	elif type == TYPE_INT and int(prop.get("hint", 0)) == PROPERTY_HINT_ENUM:
		var pick := OptionButton.new()
		pick.focus_mode = Control.FOCUS_NONE
		pick.fit_to_longest_item = false
		var at := 0
		for part in str(prop.get("hint_string", "")).split(","):
			var pieces := part.split(":")
			var value := int(pieces[1]) if pieces.size() > 1 else at
			pick.add_item(pieces[0].strip_edges(), value)
			at = value + 1
		var sync := func() -> void:
			var current := instance_from_id(id) as Node
			if current:
				var index := pick.get_item_index(int(current.get(key)))
				if index >= 0 and index != pick.selected:
					pick.select(index)
		sync.call()
		pick.item_selected.connect(func(index: int) -> void: commit(id, key, pick.get_item_id(index)))
		update = sync
		editor = pick
	elif type in EDITABLE:
		var field := DevToolsStyle.field("", true)
		field.text = show_value(node.get(key))
		field.select_all_on_focus = true
		var submit := func(text: String) -> void:
			var parsed: Variant = parse_value(text, type)
			var current := instance_from_id(id) as Node
			if parsed == null or not commit(id, key, parsed):
				field.add_theme_color_override("font_color", DevToolsStyle.ERROR)
			else:
				field.remove_theme_color_override("font_color")
			if current:
				field.text = show_value(current.get(key))
		field.text_submitted.connect(func(text: String) -> void:
			submit.call(text)
			field.release_focus())
		field.focus_exited.connect(func() -> void:
			var current := instance_from_id(id) as Node
			if current and field.text != show_value(current.get(key)):
				submit.call(field.text))
		update = func() -> void:
			var current := instance_from_id(id) as Node
			if current and not field.has_focus():
				field.text = show_value(current.get(key))
		editor = field
		if type == TYPE_COLOR:
			var swatch := ColorRect.new()
			swatch.custom_minimum_size = Vector2(14, 14)
			swatch.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			swatch.color = node.get(key)
			row.add_child(swatch)
			var refresh_field := update
			update = func() -> void:
				refresh_field.call()
				var current := instance_from_id(id) as Node
				if current:
					swatch.color = current.get(key)
	else:
		var shown := DevToolsStyle.text(show_value(node.get(key)), 12, DevToolsStyle.MUTED, 400, true)
		shown.clip_text = true
		shown.mouse_filter = Control.MOUSE_FILTER_PASS
		shown.tooltip_text = shown.text
		update = func() -> void:
			var current := instance_from_id(id) as Node
			if current:
				shown.text = show_value(current.get(key))
		editor = shown
	editor.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	editor.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	editor.name = "Value"
	row.add_child(editor)
	_rows.append({"key": key, "update": update, "editor": editor})


func _overrides(section: VBoxContainer, control: Control, listed: Array) -> void:
	var count := 0
	for prop in listed:
		var key := str(prop["name"])
		if not key.begins_with("theme_override_"):
			continue
		var check := ""
		for prefix in OVERRIDES:
			if key.begins_with(prefix):
				check = OVERRIDES[prefix]
		if check.is_empty() or not bool(control.call(check, StringName(key.get_slice("/", 1)))):
			continue
		_row(section, control, prop, key.trim_prefix("theme_override_"))
		count += 1
	if count == 0:
		section.add_child(DevToolsStyle.text("No overrides", 12, DevToolsStyle.FAINT))


func _script_vars(node: Node, listed: Array) -> void:
	var script := node.get_script() as Script
	if script == null:
		return
	var section := _section("Script")
	_fixed(section, "script", script.resource_path if not script.resource_path.is_empty() else "(built in)")
	if not str(script.get_global_name()).is_empty():
		_fixed(section, "class_name", str(script.get_global_name()))
	var count := 0
	for prop in listed:
		var usage := int(prop["usage"])
		if not (usage & PROPERTY_USAGE_SCRIPT_VARIABLE) or count >= 300:
			continue
		_row(section, node, prop, "", "export" if usage & PROPERTY_USAGE_EDITOR else "")
		count += 1
	if count == 0:
		section.add_child(DevToolsStyle.text("No script variables", 12, DevToolsStyle.FAINT))


func _update_rows() -> void:
	if selected_node() == null:
		if _selected_id != 0:
			_selected_id = 0
			_show_properties(null)
			host.highlight.show_node(null)
		return
	for row in _rows:
		var update: Callable = row["update"]
		if update.is_valid():
			update.call()


func commit(id: int, key: String, value: Variant) -> bool:
	var node := instance_from_id(id) as Node
	if node == null:
		return false
	var before: Variant = node.get(key)
	if typeof(before) != TYPE_NIL and typeof(value) != typeof(before):
		value = type_convert(value, typeof(before))
	node.set(key, value)
	if key == "name":
		rebuild()
		title_label.text = String(node.name)
		path_field.text = str(node.get_path())
	return true


func edit(key: String, text: String) -> bool:
	for row in _rows:
		if row["key"] == key and row["editor"] is LineEdit:
			var field := row["editor"] as LineEdit
			field.text = text
			field.text_submitted.emit(text)
			return true
	return false


static func show_value(value: Variant) -> String:
	match typeof(value):
		TYPE_NIL:
			return "null"
		TYPE_FLOAT:
			return _num(value)
		TYPE_VECTOR2:
			return "%s, %s" % [_num(value.x), _num(value.y)]
		TYPE_VECTOR2I:
			return "%d, %d" % [value.x, value.y]
		TYPE_VECTOR3:
			return "%s, %s, %s" % [_num(value.x), _num(value.y), _num(value.z)]
		TYPE_VECTOR3I:
			return "%d, %d, %d" % [value.x, value.y, value.z]
		TYPE_VECTOR4:
			return "%s, %s, %s, %s" % [_num(value.x), _num(value.y), _num(value.z), _num(value.w)]
		TYPE_RECT2:
			return "%s, %s, %s, %s" % [_num(value.position.x), _num(value.position.y), _num(value.size.x), _num(value.size.y)]
		TYPE_RECT2I:
			return "%d, %d, %d, %d" % [value.position.x, value.position.y, value.size.x, value.size.y]
		TYPE_COLOR:
			return "#" + (value as Color).to_html((value as Color).a < 1.0)
		TYPE_STRING, TYPE_STRING_NAME, TYPE_NODE_PATH:
			return str(value)
		TYPE_OBJECT:
			var object: Object = value
			if object == null or not is_instance_valid(object):
				return "null"
			if object is Node:
				return "%s (%s)" % [(object as Node).name, object.get_class()]
			if object is StyleBoxFlat:
				var box := object as StyleBoxFlat
				return "StyleBoxFlat  bg #%s  border #%s  radius %d" % [box.bg_color.to_html(), box.border_color.to_html(), box.corner_radius_top_left]
			if object is Resource and not (object as Resource).resource_path.is_empty():
				return "%s %s" % [object.get_class(), (object as Resource).resource_path]
			return object.get_class()
		TYPE_DICTIONARY:
			var map: Dictionary = value
			var parts := PackedStringArray()
			for entry_key in map:
				if parts.size() >= 6:
					break
				parts.append("%s: %s" % [_brief(entry_key), _brief(map[entry_key])])
			return "{%s%s}  (%d)" % [", ".join(parts), ", …" if map.size() > 6 else "", map.size()]
		TYPE_ARRAY, TYPE_PACKED_STRING_ARRAY, TYPE_PACKED_INT32_ARRAY, TYPE_PACKED_FLOAT32_ARRAY, TYPE_PACKED_VECTOR2_ARRAY, TYPE_PACKED_BYTE_ARRAY, TYPE_PACKED_INT64_ARRAY, TYPE_PACKED_FLOAT64_ARRAY, TYPE_PACKED_COLOR_ARRAY, TYPE_PACKED_VECTOR3_ARRAY, TYPE_PACKED_VECTOR4_ARRAY:
			var length: int = value.size()
			var parts := PackedStringArray()
			for index in range(mini(length, 8)):
				parts.append(_brief(value[index]))
			return "[%s%s]  (%d)" % [", ".join(parts), ", …" if length > 8 else "", length]
	return str(value)


static func _brief(value: Variant) -> String:
	match typeof(value):
		TYPE_ARRAY, TYPE_PACKED_STRING_ARRAY, TYPE_PACKED_INT32_ARRAY, TYPE_PACKED_FLOAT32_ARRAY, TYPE_PACKED_VECTOR2_ARRAY, TYPE_PACKED_BYTE_ARRAY, TYPE_PACKED_INT64_ARRAY, TYPE_PACKED_FLOAT64_ARRAY, TYPE_PACKED_COLOR_ARRAY, TYPE_PACKED_VECTOR3_ARRAY, TYPE_PACKED_VECTOR4_ARRAY:
			return "[…%d]" % value.size()
		TYPE_DICTIONARY:
			return "{…%d}" % (value as Dictionary).size()
		TYPE_OBJECT:
			var object: Object = value
			return object.get_class() if object != null and is_instance_valid(object) else "null"
		TYPE_STRING, TYPE_STRING_NAME:
			var text := str(value)
			return JSON.stringify(text.substr(0, 40) + ("…" if text.length() > 40 else ""))
	var plain := str(value)
	return plain.substr(0, 40) + ("…" if plain.length() > 40 else "")


static func _num(value: float) -> String:
	return String.num(snappedf(value, 0.001), 3)


static func parse_value(text: String, type: int) -> Variant:
	var trimmed := text.strip_edges()
	match type:
		TYPE_INT:
			if trimmed.is_valid_int():
				return trimmed.to_int()
			if trimmed.is_valid_float():
				return int(trimmed.to_float())
			return null
		TYPE_FLOAT:
			if trimmed.is_valid_float() or trimmed.is_valid_int():
				return trimmed.to_float()
			return null
		TYPE_STRING:
			return text
		TYPE_STRING_NAME:
			return StringName(text)
		TYPE_NODE_PATH:
			return NodePath(trimmed)
		TYPE_COLOR:
			if trimmed.begins_with("#") or Color.html_is_valid(trimmed):
				return Color.html(trimmed) if Color.html_is_valid(trimmed) else null
			var parts := _numbers(trimmed)
			if parts.size() == 3 or parts.size() == 4:
				return Color(parts[0], parts[1], parts[2], parts[3] if parts.size() == 4 else 1.0)
			var named := Color.from_string(trimmed, Color(0, 0, 0, -1))
			return named if named.a >= 0.0 else null
	var numbers := _numbers(trimmed)
	match type:
		TYPE_VECTOR2:
			return Vector2(numbers[0], numbers[1]) if numbers.size() == 2 else null
		TYPE_VECTOR2I:
			return Vector2i(int(numbers[0]), int(numbers[1])) if numbers.size() == 2 else null
		TYPE_VECTOR3:
			return Vector3(numbers[0], numbers[1], numbers[2]) if numbers.size() == 3 else null
		TYPE_VECTOR3I:
			return Vector3i(int(numbers[0]), int(numbers[1]), int(numbers[2])) if numbers.size() == 3 else null
		TYPE_VECTOR4:
			return Vector4(numbers[0], numbers[1], numbers[2], numbers[3]) if numbers.size() == 4 else null
		TYPE_RECT2:
			return Rect2(numbers[0], numbers[1], numbers[2], numbers[3]) if numbers.size() == 4 else null
		TYPE_RECT2I:
			return Rect2i(int(numbers[0]), int(numbers[1]), int(numbers[2]), int(numbers[3])) if numbers.size() == 4 else null
	return null


static func _numbers(text: String) -> PackedFloat64Array:
	var inner := text
	var open := text.find("(")
	if open >= 0:
		inner = text.substr(open + 1).trim_suffix(")")
	var found := PackedFloat64Array()
	var pattern := RegEx.create_from_string("-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?")
	for hit in pattern.search_all(inner):
		found.append(hit.get_string().to_float())
	return found
