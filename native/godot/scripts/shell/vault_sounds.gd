class_name VaultSounds
extends Node

signal played(name: String)

const RATE := 44100
const LEVEL := 0.5
const ORDER := ["spin", "unlock", "open", "rattle"]
const RATTLES := 3
const LATE_MS := 400

var enabled := true
var _streams := {}
var _rattles: Array[AudioStreamWAV] = []
var _rattle_turn := 0
var _pending := {}
var _players: Array[AudioStreamPlayer] = []
var _threads: Array[Thread] = []
var _noise := PackedFloat32Array()
var _lock := Mutex.new()
var _cancelled := false
var _spin_seconds := 1.5
var _open_seconds := 1.8


func prepare(spin_seconds := 1.5, open_seconds := 1.8) -> void:
	if not _threads.is_empty():
		return
	_spin_seconds = spin_seconds
	_open_seconds = open_seconds
	for index in range(4):
		var player := AudioStreamPlayer.new()
		add_child(player)
		_players.append(player)
	var random := RandomNumberGenerator.new()
	random.randomize()
	_noise.resize(RATE)
	for index in range(RATE):
		_noise[index] = random.randf() * 2.0 - 1.0
	for name in ORDER:
		var thread := Thread.new()
		thread.start(_render_one.bind(str(name), random.randi()))
		_threads.append(thread)


func _exit_tree() -> void:
	_cancelled = true
	for thread in _threads:
		if thread.is_started():
			thread.wait_to_finish()


func is_rendered() -> bool:
	_lock.lock()
	var done := _streams.size() == ORDER.size()
	_lock.unlock()
	return done


func stats() -> Dictionary:
	var result := {}
	_lock.lock()
	for name in _streams.keys():
		var stream: AudioStreamWAV = _streams[name]
		var peak := 0
		var data := stream.data
		for index in range(0, data.size(), 2):
			peak = maxi(peak, absi(data.decode_s16(index)))
		result[name] = {"seconds": stream.get_length(), "peak": float(peak) / 32767.0}
	_lock.unlock()
	return result


func rattle() -> void:
	_play("rattle")


func spin() -> void:
	_play("spin")


func unlock() -> void:
	_play("unlock")


func open() -> void:
	_play("open")


func dispose() -> void:
	_pending.clear()
	for player in _players:
		player.stop()


func _play(name: String) -> void:
	if not enabled:
		return
	var stream := _stream_for(name)
	if stream:
		_start(stream)
		played.emit(name)
	else:
		_pending[name] = Time.get_ticks_msec()


func _stream_for(name: String) -> AudioStreamWAV:
	_lock.lock()
	var stream: AudioStreamWAV = null
	if name == "rattle" and not _rattles.is_empty():
		stream = _rattles[_rattle_turn % _rattles.size()]
		_rattle_turn += 1
	elif _streams.has(name):
		stream = _streams[name]
	_lock.unlock()
	return stream


func _start(stream: AudioStreamWAV) -> void:
	for player in _players:
		if not player.playing:
			player.stream = stream
			player.play()
			return
	var oldest := _players[0]
	oldest.stream = stream
	oldest.play()


func _landed(name: String) -> void:
	if not _pending.has(name):
		return
	var asked: int = _pending[name]
	_pending.erase(name)
	if Time.get_ticks_msec() - asked <= LATE_MS and enabled:
		var stream := _stream_for(name)
		if stream:
			_start(stream)
			played.emit(name)


func _render_one(name: String, seed: int) -> void:
	var random := RandomNumberGenerator.new()
	random.seed = seed
	var noise := _noise
	var takes := RATTLES if name == "rattle" else 1
	for take in range(takes):
		if _cancelled:
			return
		var samples := PackedFloat32Array()
		match name:
			"spin":
				samples = _spin(noise, random, _spin_seconds)
			"unlock":
				samples = _unlock(noise, random)
			"open":
				samples = _open(noise, random, _open_seconds)
			_:
				samples = _rattle(noise, random)
		var stream := _wav(samples)
		_lock.lock()
		if take == 0:
			_streams[name] = stream
		if name == "rattle":
			_rattles.append(stream)
		_lock.unlock()
		if take == 0:
			_landed.call_deferred(name)


static func _buffer(seconds: float) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(int(ceil(seconds * RATE)) + 1)
	return out


static func _envelope(events: Array, start: int, count: int) -> PackedFloat32Array:
	var values := PackedFloat32Array()
	values.resize(count)
	var segment := 0
	var last := events.size() - 1
	for index in range(count):
		var t := float(start + index) / RATE
		while segment < last and float(events[segment + 1][0]) <= t:
			segment += 1
		var here: Array = events[segment]
		var value := float(here[1])
		if t >= float(here[0]) and segment < last and bool(events[segment + 1][2]):
			var next: Array = events[segment + 1]
			var t0 := float(here[0])
			var t1 := float(next[0])
			var v1 := float(next[1])
			if t1 > t0 and value > 0.0 and v1 > 0.0:
				value = value * pow(v1 / value, (t - t0) / (t1 - t0))
		values[index] = value
	return values


static func _constant(value: float, count: int) -> PackedFloat32Array:
	var values := PackedFloat32Array()
	values.resize(count)
	values.fill(value)
	return values


static func _coefficients(type: String, frequency: float, q: float) -> PackedFloat64Array:
	var nyquist := RATE * 0.5
	var f := clampf(frequency, 0.0, nyquist)
	var w0 := TAU * f / RATE
	var cw := cos(w0)
	var sw := sin(w0)
	var b0 := 0.0
	var b1 := 0.0
	var b2 := 0.0
	var a0 := 1.0
	var a1 := 0.0
	var a2 := 0.0
	match type:
		"lowpass":
			var alpha := sw / (2.0 * pow(10.0, q / 20.0))
			b0 = (1.0 - cw) / 2.0
			b1 = 1.0 - cw
			b2 = (1.0 - cw) / 2.0
			a0 = 1.0 + alpha
			a1 = -2.0 * cw
			a2 = 1.0 - alpha
		"highpass":
			var alpha := sw / (2.0 * pow(10.0, q / 20.0))
			b0 = (1.0 + cw) / 2.0
			b1 = -(1.0 + cw)
			b2 = (1.0 + cw) / 2.0
			a0 = 1.0 + alpha
			a1 = -2.0 * cw
			a2 = 1.0 - alpha
		_:
			var alpha := sw / (2.0 * q)
			b0 = alpha
			b1 = 0.0
			b2 = -alpha
			a0 = 1.0 + alpha
			a1 = -2.0 * cw
			a2 = 1.0 - alpha
	return PackedFloat64Array([b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0])


static func _filtered_noise(noise: PackedFloat32Array, position: float, count: int, type: String, frequency: PackedFloat32Array, q: float) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(count)
	var x1 := 0.0
	var x2 := 0.0
	var y1 := 0.0
	var y2 := 0.0
	var b0 := 0.0
	var b1 := 0.0
	var b2 := 0.0
	var a1 := 0.0
	var a2 := 0.0
	var length := noise.size()
	var first := int(floorf(position))
	var share := position - floorf(position)
	for index in range(count):
		if index % 128 == 0:
			var c := _coefficients(type, frequency[index], q)
			b0 = c[0]
			b1 = c[1]
			b2 = c[2]
			a1 = c[3]
			a2 = c[4]
		var at := (first + index) % length
		var x := noise[at] + (noise[(at + 1) % length] - noise[at]) * share
		var y := b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
		x2 = x1
		x1 = x
		y2 = y1
		y1 = y
		out[index] = y
	return out


static func _table(type: String, top_frequency: float) -> PackedFloat32Array:
	var size := 2048
	var table := PackedFloat32Array()
	table.resize(size + 1)
	var harmonics := maxi(1, int(floor(RATE * 0.5 / maxf(1.0, top_frequency))))
	var peak := 0.0
	for index in range(size):
		var phase := TAU * float(index) / size
		var value := 0.0
		if type == "square":
			for k in range(1, harmonics + 1, 2):
				value += 4.0 / (PI * k) * sin(k * phase)
		elif type == "triangle":
			for k in range(1, harmonics + 1, 2):
				var sign := 1.0 if k % 4 == 1 else -1.0
				value += 8.0 / (PI * PI * k * k) * sign * sin(k * phase)
		else:
			value = sin(phase)
		table[index] = value
		peak = maxf(peak, absf(value))
	if peak > 0.0:
		for index in range(size):
			table[index] /= peak
	table[size] = table[0]
	return table


static func _oscillator(type: String, frequency: PackedFloat32Array, count: int) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(count)
	var top := 0.0
	for index in range(frequency.size()):
		top = maxf(top, frequency[index])
	var table := _table(type, top)
	var size := table.size() - 1
	var phase := 0.0
	for index in range(count):
		var position := phase * size
		var at := int(position)
		var share := position - at
		out[index] = table[at] + (table[at + 1] - table[at]) * share
		phase += frequency[index] / RATE
		phase -= floor(phase)
	return out


static func _mix(out: PackedFloat32Array, start: int, samples: PackedFloat32Array, gain: PackedFloat32Array) -> PackedFloat32Array:
	var size := out.size()
	for index in range(samples.size()):
		var at := start + index
		if at >= 0 and at < size:
			out[at] += samples[index] * gain[index] * LEVEL
	return out


static func _hiss(out: PackedFloat32Array, noise: PackedFloat32Array, random: RandomNumberGenerator, at: float, length: float, type: String, frequency: float, q: float, peak: float, ramp: Array = []) -> PackedFloat32Array:
	var start := int(ceil(at * RATE))
	var count := int(ceil((at + length + 0.02) * RATE)) - start
	var gain := _envelope([[at, 0.0001, false], [at + minf(0.006, length / 4.0), peak, true], [at + length, 0.0001, true]], start, count)
	var frequencies := _constant(frequency, count)
	if not ramp.is_empty():
		frequencies = _envelope(ramp, start, count)
	var position := random.randf() * 0.5 * RATE + (float(start) - at * RATE)
	var filtered := _filtered_noise(noise, position, count, type, frequencies, q)
	return _mix(out, start, filtered, gain)


static func _tone(out: PackedFloat32Array, at: float, length: float, type: String, from: float, to: float, peak: float) -> PackedFloat32Array:
	var start := int(round(at * RATE))
	var count := int(round((at + length + 0.02) * RATE)) - start
	var frequencies := _constant(from, count)
	if to != from:
		frequencies = _envelope([[at, from, false], [at + length, to, true]], start, count)
	var gain := _envelope([[at, 0.0001, false], [at + 0.008, peak, true], [at + length, 0.0001, true]], start, count)
	var wave := _oscillator(type, frequencies, count)
	return _mix(out, start, wave, gain)


static func _click(out: PackedFloat32Array, noise: PackedFloat32Array, random: RandomNumberGenerator, at: float, peak: float) -> PackedFloat32Array:
	out = _hiss(out, noise, random, at, 0.022, "highpass", 1800.0, 1.0, peak)
	return _tone(out, at, 0.03, "square", 1250.0, 700.0, peak * 0.18)


static func _rattle(noise: PackedFloat32Array, random: RandomNumberGenerator) -> PackedFloat32Array:
	var out := _buffer(0.32)
	for knock in [[0.0, 0.35], [0.07, 0.28], [0.15, 0.22]]:
		var offset := float(knock[0])
		var peak := float(knock[1])
		out = _hiss(out, noise, random, offset, 0.05, "bandpass", 2400.0, 4.0, peak)
		out = _tone(out, offset, 0.09, "triangle", 420.0, 300.0, peak * 0.25)
	return _tone(out, 0.0, 0.28, "sine", 95.0, 60.0, 0.3)


static func _spin(noise: PackedFloat32Array, random: RandomNumberGenerator, seconds: float) -> PackedFloat32Array:
	var out := _buffer(seconds + 0.08)
	var at := 0.0
	var gap := 0.045
	while at < seconds - 0.05:
		out = _click(out, noise, random, at, 0.42)
		at += gap
		gap *= 1.045
	return _hiss(out, noise, random, 0.0, seconds, "bandpass", 520.0, 1.2, 0.12, [[0.0, 520.0, false], [seconds, 260.0, true]])


static func _unlock(noise: PackedFloat32Array, random: RandomNumberGenerator) -> PackedFloat32Array:
	var out := _buffer(0.64)
	out = _tone(out, 0.0, 0.42, "sine", 150.0, 42.0, 0.9)
	out = _hiss(out, noise, random, 0.0, 0.18, "lowpass", 420.0, 1.0, 0.7)
	out = _tone(out, 0.01, 0.6, "triangle", 930.0, 900.0, 0.1)
	return _tone(out, 0.012, 0.45, "triangle", 1410.0, 1380.0, 0.05)


static func _open(noise: PackedFloat32Array, random: RandomNumberGenerator, seconds: float) -> PackedFloat32Array:
	var out := _buffer(seconds + 0.74)
	out = _hiss(out, noise, random, 0.0, 0.5, "highpass", 3200.0, 1.0, 0.16)
	var count := int(round((seconds + 0.3) * RATE))
	var swell := _envelope([[0.0, 0.0001, false], [seconds * 0.3, 0.9, true], [seconds * 0.85, 0.5, true], [seconds + 0.25, 0.0001, true]], 0, count)
	var rumble := _filtered_noise(noise, 0.0, count, "lowpass", _constant(170.0, count), 1.0)
	out = _mix(out, 0, rumble, swell)
	out = _hiss(out, noise, random, 0.05, seconds, "bandpass", 850.0, 2.5, 0.1, [[0.0, 850.0, false], [seconds, 520.0, true]])
	out = _tone(out, seconds, 0.7, "sine", 78.0, 38.0, 0.85)
	return _hiss(out, noise, random, seconds, 0.25, "lowpass", 300.0, 1.0, 0.5)


static func _wav(samples: PackedFloat32Array) -> AudioStreamWAV:
	var data := PackedByteArray()
	data.resize(samples.size() * 2)
	for index in range(samples.size()):
		data.encode_s16(index * 2, int(clampf(samples[index], -1.0, 1.0) * 32767.0))
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = RATE
	stream.stereo = false
	stream.data = data
	return stream
