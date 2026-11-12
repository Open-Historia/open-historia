class_name ScrollHoverFreeze
extends RefCounted

const SETTLE_MS := 150
const WHEEL_RECENT_MS := 250
const HOOKED := &"oh_scroll_hover_hooked"
const HELD := &"oh_scroll_hover_held"

static var _one: ScrollHoverFreeze


static func install() -> void:
	if _one != null:
		return
	var tree := Engine.get_main_loop() as SceneTree
	if tree == null or tree.root == null:
		return
	_one = ScrollHoverFreeze.new()
	tree.node_added.connect(_one._on_node_added)
	_one._sweep(tree.root)


static func scrolling(scroll: ScrollContainer) -> bool:
	return scroll.has_meta(HELD)


func _sweep(node: Node) -> void:
	_on_node_added(node)
	for child in node.get_children():
		_sweep(child)


func _on_node_added(node: Node) -> void:
	var scroll := node as ScrollContainer
	if scroll == null or scroll.has_meta(HOOKED):
		return
	scroll.set_meta(HOOKED, true)
	var held: WeakRef = weakref(scroll)
	scroll.gui_input.connect(_on_input.bind(held))
	scroll.get_v_scroll_bar().value_changed.connect(_on_scrolled.bind(held))
	scroll.get_h_scroll_bar().value_changed.connect(_on_scrolled.bind(held))


func _on_input(event: InputEvent, ref: WeakRef) -> void:
	var press := event as InputEventMouseButton
	if press == null or not press.pressed:
		return
	if press.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN, MOUSE_BUTTON_WHEEL_LEFT, MOUSE_BUTTON_WHEEL_RIGHT]:
		var scroll: ScrollContainer = ref.get_ref()
		if scroll:
			scroll.set_meta(&"oh_wheel_at", Time.get_ticks_msec())


func _on_scrolled(_value: float, ref: WeakRef) -> void:
	var scroll: ScrollContainer = ref.get_ref()
	if scroll == null or not scroll.is_inside_tree():
		return
	var recent := Time.get_ticks_msec() - int(scroll.get_meta(&"oh_wheel_at", -WHEEL_RECENT_MS - 1)) <= WHEEL_RECENT_MS
	if not recent and not scroll.has_meta(HELD):
		return
	if not scroll.has_meta(HELD):
		var kept := {}
		for child in scroll.get_children():
			var content := child as Control
			if content:
				kept[content.get_instance_id()] = content.mouse_behavior_recursive
				content.mouse_behavior_recursive = Control.MOUSE_BEHAVIOR_DISABLED
		scroll.set_meta(HELD, kept)
	var turn := int(scroll.get_meta(&"oh_scroll_turn", 0)) + 1
	scroll.set_meta(&"oh_scroll_turn", turn)
	scroll.get_tree().create_timer(SETTLE_MS / 1000.0).timeout.connect(_settle.bind(ref, turn))


func _settle(ref: WeakRef, turn: int) -> void:
	var scroll: ScrollContainer = ref.get_ref()
	if scroll == null or int(scroll.get_meta(&"oh_scroll_turn", 0)) != turn or not scroll.has_meta(HELD):
		return
	var kept: Dictionary = scroll.get_meta(HELD)
	scroll.remove_meta(HELD)
	for child in scroll.get_children():
		var content := child as Control
		if content and kept.has(content.get_instance_id()):
			content.mouse_behavior_recursive = kept[content.get_instance_id()]
